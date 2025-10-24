import { FastifyInstance } from 'fastify';
import { supabaseAdmin, verifyToken } from '../lib/supabase';

interface DeleteAccountBody {
  confirmation: boolean;
}

export async function accountRoutes(fastify: FastifyInstance) {
  // Get user profile
  fastify.get('/account/profile', async (request, reply) => {
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

      const { data: profile, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('id', verified.userId)
        .maybeSingle();

      if (error) {
        fastify.log.error({ err: error }, 'Error fetching profile');
        return reply.code(500).send({ error: 'Failed to fetch profile' });
      }

      // If profile doesn't exist, create it as a fallback
      // This handles edge cases where the trigger didn't fire
      if (!profile) {
        fastify.log.warn({ userId: verified.userId }, 'Profile not found, attempting to create');
        
        // Get user info from auth
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(verified.userId);
        
        if (authError || !authUser) {
          fastify.log.error({ err: authError }, 'Auth user not found');
          return reply.code(404).send({ error: 'User not found' });
        }

        // Create the missing user record
        const { data: newProfile, error: createError } = await supabaseAdmin
          .from('users')
          .insert({
            id: authUser.user.id,
            email: authUser.user.email!,
            name: authUser.user.user_metadata?.name || authUser.user.email!.split('@')[0],
            created_at: authUser.user.created_at,
            updated_at: new Date().toISOString()
          })
          .select()
          .single();

        if (createError) {
          fastify.log.error({ err: createError }, 'Error creating profile');
          return reply.code(500).send({ error: 'Failed to create profile' });
        }

        fastify.log.info({ userId: verified.userId }, 'Profile created successfully');
        return newProfile;
      }

      return profile;
    } catch (error) {
      fastify.log.error({ err: error }, 'Get profile error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

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

  // Update user profile (name, bio, age, location, gender - all optional)
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

      const { name, bio, age, location, gender } = request.body as { 
        name?: string;
        bio?: string;
        age?: number;
        location?: string;
        gender?: string;
      };

      // Build update object dynamically (only update provided fields)
      const updates: any = {
        updated_at: new Date().toISOString()
      };

      // Validate and add name if provided
      if (name !== undefined) {
        if (name.trim().length === 0) {
          return reply.code(400).send({ error: 'Name cannot be empty if provided' });
        }
        updates.name = name.trim();
      }

      // Validate and add bio if provided
      if (bio !== undefined) {
        if (bio.length > 500) {
          return reply.code(400).send({ error: 'Bio must be 500 characters or less' });
        }
        updates.bio = bio.trim() || null;
      }

      // Validate and add age if provided
      if (age !== undefined) {
        if (age !== null && (age < 13 || age > 120)) {
          return reply.code(400).send({ error: 'Age must be between 13 and 120' });
        }
        updates.age = age;
      }

      // Add location if provided
      if (location !== undefined) {
        updates.location = location.trim() || null;
      }

      // Validate and add gender if provided
      if (gender !== undefined) {
        const validGenders = ['masculine', 'feminine', 'non-binary', 'other'];
        if (gender !== null && !validGenders.includes(gender)) {
          return reply.code(400).send({ 
            error: 'Gender must be one of: masculine, feminine, non-binary, other' 
          });
        }
        updates.gender = gender;
      }

      const { error } = await supabaseAdmin
        .from('users')
        .update(updates)
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
