import { FastifyInstance } from 'fastify';
import { supabaseAdmin, verifyToken } from '../lib/supabase';

interface BlockUserBody {
  blockedUserId: string;
}

export async function blockRoutes(fastify: FastifyInstance) {
  // Block a user
  fastify.post('/blocks', async (request, reply) => {
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

      const { blockedUserId } = request.body as BlockUserBody;

      if (!blockedUserId) {
        return reply.code(400).send({ error: 'Blocked user ID is required' });
      }

      if (blockedUserId === verified.userId) {
        return reply.code(400).send({ error: 'Cannot block yourself' });
      }

      // Check if block already exists
      const { data: existing } = await supabaseAdmin
        .from('blocks')
        .select('*')
        .eq('blocker_id', verified.userId)
        .eq('blocked_id', blockedUserId)
        .single();

      if (existing) {
        return reply.code(400).send({ error: 'User is already blocked' });
      }

      // Create block
      const { error } = await supabaseAdmin
        .from('blocks')
        .insert({
          blocker_id: verified.userId,
          blocked_id: blockedUserId,
          created_at: new Date().toISOString()
        });

      if (error) {
        fastify.log.error({ err: error }, 'Error creating block');
        return reply.code(500).send({ error: 'Failed to block user' });
      }

      return { success: true };
    } catch (error) {
      fastify.log.error({ err: error }, 'Block user error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Unblock a user
  fastify.delete('/blocks/:blockedUserId', async (request, reply) => {
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

      const { blockedUserId } = request.params as { blockedUserId: string };

      const { error } = await supabaseAdmin
        .from('blocks')
        .delete()
        .eq('blocker_id', verified.userId)
        .eq('blocked_id', blockedUserId);

      if (error) {
        fastify.log.error({ err: error }, 'Error removing block');
        return reply.code(500).send({ error: 'Failed to unblock user' });
      }

      return { success: true };
    } catch (error) {
      fastify.log.error({ err: error }, 'Unblock user error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // List blocked users
  fastify.get('/blocks', async (request, reply) => {
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

      const { data, error } = await supabaseAdmin
        .from('blocks')
        .select('blocked_id, created_at')
        .eq('blocker_id', verified.userId)
        .order('created_at', { ascending: false });

      if (error) {
        fastify.log.error({ err: error }, 'Error fetching blocks');
        return reply.code(500).send({ error: 'Failed to fetch blocked users' });
      }

      return data || [];
    } catch (error) {
      fastify.log.error({ err: error }, 'Get blocks error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
