import { FastifyInstance } from 'fastify';
import { supabaseAdmin, verifyToken } from '../lib/supabase';

interface CreateConversationBody {
  participantIds: string[];
}

interface SendMessageBody {
  conversationId: string;
  body: string;
}

export async function conversationRoutes(fastify: FastifyInstance) {
  // Create a new conversation
  fastify.post('/conversations', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const token = authHeader.substring(7);
      const verified = await verifyToken(token);
      
      if (!verified) {
        return reply.code(401).send({ error: 'Invalid token' });
      }

      const { participantIds } = request.body as CreateConversationBody;

      if (!Array.isArray(participantIds) || participantIds.length === 0) {
        return reply.code(400).send({ error: 'Invalid participant IDs' });
      }

      // Include the creator in participants
      const allParticipants = [...new Set([verified.userId, ...participantIds])];

      // Check for blocks between any participants
      for (const participantId of allParticipants) {
        if (participantId !== verified.userId) {
          const { data: blockData } = await supabaseAdmin
            .from('blocks')
            .select('*')
            .or(`blocker_id.eq.${verified.userId},blocked_id.eq.${verified.userId}`)
            .or(`blocker_id.eq.${participantId},blocked_id.eq.${participantId}`)
            .limit(1);

          if (blockData && blockData.length > 0) {
            return reply.code(403).send({ error: 'Cannot create conversation with blocked user' });
          }
        }
      }

      // Create conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .insert({ 
          is_terminated: false,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (convError || !conversation) {
        fastify.log.error({ err: convError }, 'Error creating conversation');
        return reply.code(500).send({ error: 'Failed to create conversation' });
      }

      // Add participants
      const participants = allParticipants.map(id => ({
        conversation_id: conversation.id,
        user_id: id,
        joined_at: new Date().toISOString()
      }));

      const { error: partError } = await supabaseAdmin
        .from('conversation_participants')
        .insert(participants);

      if (partError) {
        fastify.log.error({ err: partError }, 'Error adding participants');
        return reply.code(500).send({ error: 'Failed to add participants' });
      }

      return { conversationId: conversation.id };
    } catch (error) {
      fastify.log.error({ err: error }, 'Create conversation error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Send a message
  fastify.post('/conversations/:id/messages', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const token = authHeader.substring(7);
      const verified = await verifyToken(token);
      
      if (!verified) {
        return reply.code(401).send({ error: 'Invalid token' });
      }

      const { id: conversationId } = request.params as { id: string };
      const { body } = request.body as SendMessageBody;

      if (!body || body.trim().length === 0) {
        return reply.code(400).send({ error: 'Message body is required' });
      }

      // Verify user is a participant
      const { data: participant, error: partError } = await supabaseAdmin
        .from('conversation_participants')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('user_id', verified.userId)
        .single();

      if (partError || !participant) {
        return reply.code(403).send({ error: 'Not a participant of this conversation' });
      }

      // Check if conversation is terminated
      const { data: conversation } = await supabaseAdmin
        .from('conversations')
        .select('is_terminated')
        .eq('id', conversationId)
        .single();

      if (conversation?.is_terminated) {
        return reply.code(400).send({ error: 'Conversation is terminated' });
      }

      // Insert message
      const { data: message, error: msgError } = await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: verified.userId,
          body: body.trim(),
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (msgError || !message) {
        fastify.log.error({ err: msgError }, 'Error sending message');
        return reply.code(500).send({ error: 'Failed to send message' });
      }

      return { messageId: message.id };
    } catch (error) {
      fastify.log.error({ err: error }, 'Send message error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Get conversation messages
  fastify.get('/conversations/:id/messages', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const token = authHeader.substring(7);
      const verified = await verifyToken(token);
      
      if (!verified) {
        return reply.code(401).send({ error: 'Invalid token' });
      }

      const { id: conversationId } = request.params as { id: string };

      // Verify user is a participant
      const { data: participant } = await supabaseAdmin
        .from('conversation_participants')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('user_id', verified.userId)
        .single();

      if (!participant) {
        return reply.code(403).send({ error: 'Not a participant of this conversation' });
      }

      // Get messages
      const { data: messages, error } = await supabaseAdmin
        .from('messages')
        .select('id, sender_id, body, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) {
        fastify.log.error({ err: error }, 'Error fetching messages');
        return reply.code(500).send({ error: 'Failed to fetch messages' });
      }

      return messages || [];
    } catch (error) {
      fastify.log.error({ err: error }, 'Get messages error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // List user conversations
  fastify.get('/conversations', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const token = authHeader.substring(7);
      const verified = await verifyToken(token);
      
      if (!verified) {
        return reply.code(401).send({ error: 'Invalid token' });
      }

      // Get all conversations where user is a participant
      const { data: conversations, error } = await supabaseAdmin
        .from('conversation_participants')
        .select(`
          conversation_id,
          conversations!inner (
            id,
            is_terminated,
            created_at
          )
        `)
        .eq('user_id', verified.userId)
        .eq('conversations.is_terminated', false)
        .order('conversations.created_at', { ascending: false });

      if (error) {
        fastify.log.error({ err: error }, 'Error fetching conversations');
        return reply.code(500).send({ error: 'Failed to fetch conversations' });
      }

      return conversations || [];
    } catch (error) {
      fastify.log.error({ err: error }, 'Get conversations error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Terminate conversation
  fastify.post('/conversations/:id/terminate', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const token = authHeader.substring(7);
      const verified = await verifyToken(token);
      
      if (!verified) {
        return reply.code(401).send({ error: 'Invalid token' });
      }

      const { id: conversationId } = request.params as { id: string };

      // Verify user is a participant
      const { data: participant } = await supabaseAdmin
        .from('conversation_participants')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('user_id', verified.userId)
        .single();

      if (!participant) {
        return reply.code(403).send({ error: 'Not a participant of this conversation' });
      }

      // Delete all messages
      const { error: msgError } = await supabaseAdmin
        .from('messages')
        .delete()
        .eq('conversation_id', conversationId);

      if (msgError) {
        fastify.log.error({ err: msgError }, 'Error deleting messages');
      }

      // Mark conversation as terminated
      const { error: convError } = await supabaseAdmin
        .from('conversations')
        .update({ is_terminated: true })
        .eq('id', conversationId);

      if (convError) {
        fastify.log.error({ err: convError }, 'Error terminating conversation');
        return reply.code(500).send({ error: 'Failed to terminate conversation' });
      }

      return { success: true };
    } catch (error) {
      fastify.log.error({ err: error }, 'Terminate conversation error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
