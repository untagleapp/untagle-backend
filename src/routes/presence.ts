import { FastifyInstance } from 'fastify';
import { supabaseAdmin, verifyToken } from '../lib/supabase';

interface HeartbeatBody {
  userId: string;
  presenceStatus?: 'online' | 'offline';
}

export async function presenceRoutes(fastify: FastifyInstance) {
  fastify.post('/presence/heartbeat', async (request, reply) => {
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

      const body = request.body as HeartbeatBody;
      const { userId, presenceStatus } = body;

      if (userId !== verified.userId) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const updateData: any = {
        last_active_at: new Date().toISOString()
      };

      if (presenceStatus) {
        updateData.presence_status = presenceStatus;
      }

      const { error } = await supabaseAdmin
        .from('users')
        .update(updateData)
        .eq('id', userId);

      if (error) {
        fastify.log.error({ err: error }, 'Error updating presence');
        return reply.code(500).send({ error: 'Failed to update presence' });
      }

      return { success: true };
    } catch (error) {
      fastify.log.error({ err: error }, 'Heartbeat error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Update presence status (online/offline)
  fastify.post('/presence/status', async (request, reply) => {
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

      const { status } = request.body as { status: 'online' | 'offline' };

      if (!status || !['online', 'offline'].includes(status)) {
        return reply.code(400).send({ error: 'Invalid status' });
      }

      const { error } = await supabaseAdmin
        .from('users')
        .update({ 
          presence_status: status,
          last_active_at: new Date().toISOString()
        })
        .eq('id', verified.userId);

      if (error) {
        fastify.log.error({ err: error }, 'Error updating status');
        return reply.code(500).send({ error: 'Failed to update status' });
      }

      return { success: true, status };
    } catch (error) {
      fastify.log.error({ err: error }, 'Status update error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
