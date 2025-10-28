import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';

interface CleanupRequestBody {
  secret?: string;
}

export async function cleanupRoutes(fastify: FastifyInstance) {
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
