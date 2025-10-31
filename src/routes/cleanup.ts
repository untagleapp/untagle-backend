import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';

interface CleanupRequestBody {
  secret?: string;
}

export async function cleanupRoutes(fastify: FastifyInstance) {
  // Marcar usuários inativos como offline
  fastify.post('/cleanup/inactive-users', async (request, reply) => {
    try {
      fastify.log.info('🧹 Starting inactive users cleanup');

      // Get users who are marked online but haven't sent heartbeat in 60 seconds
      const sixtySecondsAgo = new Date(Date.now() - 60 * 1000).toISOString();

      const { data: inactiveUsers, error: fetchError } = await supabaseAdmin
        .from('users')
        .select('id, name, email, last_active_at, presence_status')
        .eq('presence_status', 'online')
        .lt('last_active_at', sixtySecondsAgo);

      if (fetchError) {
        fastify.log.error({ err: fetchError }, '❌ Error fetching inactive users');
        return reply.code(500).send({ error: 'Failed to fetch inactive users' });
      }

      if (!inactiveUsers || inactiveUsers.length === 0) {
        fastify.log.info('✅ No inactive users to clean up');
        return reply.send({ 
          success: true, 
          updated: 0,
          message: 'No inactive users found'
        });
      }

      fastify.log.info({ 
        count: inactiveUsers.length,
        users: inactiveUsers.map(u => ({ name: u.name, lastActive: u.last_active_at }))
      }, '⚠️ Found inactive users');

      // Mark them as offline
      const userIds = inactiveUsers.map(u => u.id);

      const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({ presence_status: 'offline' })
        .in('id', userIds);

      if (updateError) {
        fastify.log.error({ err: updateError }, '❌ Error updating users');
        return reply.code(500).send({ error: 'Failed to update users' });
      }

      fastify.log.info({ count: inactiveUsers.length }, '✅ Marked inactive users as offline');

      return reply.send({ 
        success: true, 
        updated: inactiveUsers.length,
        users: inactiveUsers.map(u => ({ name: u.name, email: u.email }))
      });

    } catch (error: any) {
      fastify.log.error({ err: error }, 'Inactive users cleanup error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Protected endpoint to manually trigger message cleanup
  // This can be called by Railway Cron or manually for testing
  fastify.post('/cleanup/messages', async (request, reply) => {
    try {
      const body = request.body as CleanupRequestBody;
      
      // Validate secret key to prevent unauthorized access
      const secret = body.secret || request.headers['x-cleanup-secret'];
      const expectedSecret = process.env.CLEANUP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!secret || secret !== expectedSecret) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        // Call the delete_old_messages() function
        const { error } = await supabaseAdmin.rpc('delete_old_messages');

        if (error) {
          fastify.log.error({ error }, 'Failed to delete old messages');
          return reply.code(500).send({ 
            error: 'Failed to delete old messages',
            details: error.message 
          });
        }

        fastify.log.info('Successfully deleted old messages');
        
        return reply.send({ 
          success: true,
          message: 'Old messages deleted successfully',
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        fastify.log.error({ error }, 'Error in cleanup endpoint');
        return reply.code(500).send({ 
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );

  // Health check for cleanup service
  fastify.get('/cleanup/status', async (_request: unknown, reply) => {
    try {
      // Check if the delete_old_messages function exists
      const { error } = await supabaseAdmin.rpc('delete_old_messages');

      return reply.send({
        status: error ? 'error' : 'ok',
        functionExists: !error,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return reply.code(500).send({ 
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}
