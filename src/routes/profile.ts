import { FastifyInstance } from 'fastify';
import { supabaseAdmin, verifyToken } from '../lib/supabase';

interface ProfileConfirmBody {
  userId: string;
  storagePath: string;
  publicUrl: string;
}

export async function profileRoutes(fastify: FastifyInstance) {
  fastify.post('/profile/confirm', async (request, reply) => {
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

      const body = request.body as ProfileConfirmBody;
      const { userId, storagePath, publicUrl } = body;

      if (userId !== verified.userId) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      // Update user profile with new image path
      const { error } = await supabaseAdmin
        .from('users')
        .update({ 
          profile_image_path: storagePath,
          profile_image_url: publicUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        fastify.log.error({ err: error }, 'Error updating profile');
        return reply.code(500).send({ error: 'Failed to update profile' });
      }

      return { success: true };
    } catch (error) {
      fastify.log.error({ err: error }, 'Profile confirm error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Get user profile
  fastify.get('/profile/:userId', async (request, reply) => {
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

      const { userId } = request.params as { userId: string };

      // Check for blocks between users
      const { data: blockData } = await supabaseAdmin
        .from('blocks')
        .select('*')
        .or(`blocker_id.eq.${verified.userId},blocked_id.eq.${verified.userId}`)
        .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`)
        .limit(1);

      if (blockData && blockData.length > 0) {
        return reply.code(403).send({ error: 'User not accessible' });
      }

      const { data, error } = await supabaseAdmin
        .from('users')
        .select('id, name, profile_image_url, presence_status, last_active_at')
        .eq('id', userId)
        .single();

      if (error || !data) {
        return reply.code(404).send({ error: 'User not found' });
      }

      return data;
    } catch (error) {
      fastify.log.error({ err: error }, 'Get profile error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
