import { FastifyInstance } from 'fastify';
import { supabaseAdmin, verifyToken } from '../lib/supabase';

interface DeleteAccountBody {
  confirmation: boolean;
}

export async function accountRoutes(fastify: FastifyInstance) {
  // Delete user account
  fastify.post('/account/delete', async (request, reply) => {
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

      const { confirmation } = request.body as DeleteAccountBody;

      if (!confirmation) {
        return reply.code(400).send({ error: 'Confirmation required' });
      }

      const userId = verified.userId;

      // Log deletion request for audit
      fastify.log.info(`Account deletion requested for user: ${userId}`);

      // Delete user's profile images from storage
      const { data: userData } = await supabaseAdmin
        .from('users')
        .select('profile_image_path')
        .eq('id', userId)
        .single();

      if (userData?.profile_image_path) {
        const { error: storageError } = await supabaseAdmin.storage
          .from('profiles')
          .remove([userData.profile_image_path]);

        if (storageError) {
          fastify.log.error({ err: storageError }, 'Error deleting profile image');
        }
      }

      // Delete user's locations
      await supabaseAdmin
        .from('locations')
        .delete()
        .eq('user_id', userId);

      // Delete user's messages
      await supabaseAdmin
        .from('messages')
        .delete()
        .eq('sender_id', userId);

      // Delete user's conversation participations
      await supabaseAdmin
        .from('conversation_participants')
        .delete()
        .eq('user_id', userId);

      // Delete blocks where user is blocker or blocked
      await supabaseAdmin
        .from('blocks')
        .delete()
        .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);

      // Delete user record from users table
      const { error: userError } = await supabaseAdmin
        .from('users')
        .delete()
        .eq('id', userId);

      if (userError) {
        fastify.log.error({ err: userError }, 'Error deleting user');
        return reply.code(500).send({ error: 'Failed to delete account' });
      }

      // Delete from Supabase Auth
      const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);

      if (authError) {
        fastify.log.error({ err: authError }, 'Error deleting auth user');
      }

      fastify.log.info(`Account deleted successfully for user: ${userId}`);

      return { success: true, message: 'Account deleted successfully' };
    } catch (error) {
      fastify.log.error({ err: error }, 'Delete account error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Update user profile (name, etc.)
  fastify.patch('/account/profile', async (request, reply) => {
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

      const { name } = request.body as { name?: string };

      if (!name || name.trim().length === 0) {
        return reply.code(400).send({ error: 'Name is required' });
      }

      const { error } = await supabaseAdmin
        .from('users')
        .update({ 
          name: name.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', verified.userId);

      if (error) {
        fastify.log.error({ err: error }, 'Error updating profile');
        return reply.code(500).send({ error: 'Failed to update profile' });
      }

      return { success: true };
    } catch (error) {
      fastify.log.error({ err: error }, 'Update profile error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
