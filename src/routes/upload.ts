import { FastifyInstance } from 'fastify';
import { supabaseAdmin, verifyToken } from '../lib/supabase';

interface UploadUrlBody {
  userId: string;
  fileName: string;
  contentType: string;
}

export async function uploadRoutes(fastify: FastifyInstance) {
  fastify.post('/upload-url', async (request, reply) => {
    try {
      // Get token from Authorization header
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const token = authHeader.substring(7);
      const verified = await verifyToken(token);
      
      if (!verified) {
        return reply.code(401).send({ error: 'Invalid token' });
      }

      const body = request.body as UploadUrlBody;
      const { userId, fileName, contentType } = body;

      // Verify the userId matches the token
      if (userId !== verified.userId) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      // Validate content type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(contentType)) {
        return reply.code(400).send({ error: 'Invalid content type' });
      }

      // Generate unique file path
      const timestamp = Date.now();
      const fileExtension = fileName.split('.').pop();
      const storagePath = `avatars/${userId}/${timestamp}.${fileExtension}`;

      // Create signed upload URL (valid for 5 minutes)
      const { data, error } = await supabaseAdmin.storage
        .from('profiles')
        .createSignedUploadUrl(storagePath);

      if (error) {
        fastify.log.error({ err: error }, 'Error creating signed URL');
        return reply.code(500).send({ error: 'Failed to create upload URL' });
      }

      // Get public URL for the file
      const { data: publicUrlData } = supabaseAdmin.storage
        .from('profiles')
        .getPublicUrl(storagePath);

      return {
        uploadUrl: data.signedUrl,
        storagePath,
        publicUrl: publicUrlData.publicUrl,
        token: data.token
      };
    } catch (error) {
      fastify.log.error({ err: error }, 'Upload URL error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
