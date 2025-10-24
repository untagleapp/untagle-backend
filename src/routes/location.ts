import { FastifyInstance } from 'fastify';
import { supabaseAdmin, verifyToken, truncateCoordinate } from '../lib/supabase';

interface LocationData {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  recordedAt: string;
}

interface LocationBatchBody {
  userId: string;
  locations: LocationData[];
}

export async function locationRoutes(fastify: FastifyInstance) {
  fastify.post('/locations/batch', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
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

      const body = request.body as LocationBatchBody;
      const { userId, locations } = body;

      if (userId !== verified.userId) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      if (!Array.isArray(locations) || locations.length === 0) {
        return reply.code(400).send({ error: 'Invalid locations data' });
      }

      // Verify user exists in database
      const { data: userExists, error: userError } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

      if (userError) {
        fastify.log.error({ err: userError }, 'Error checking user existence');
        return reply.code(500).send({ error: 'Failed to verify user' });
      }

      if (!userExists) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Truncate coordinates to 5 decimal places for privacy (~1.1m precision)
      const processedLocations = locations.map(loc => ({
        user_id: userId,
        latitude: truncateCoordinate(loc.latitude),
        longitude: truncateCoordinate(loc.longitude),
        accuracy: loc.accuracy,
        speed: loc.speed,
        heading: loc.heading,
        recorded_at: loc.recordedAt,
        created_at: new Date().toISOString()
      }));

      fastify.log.info({ 
        userId, 
        count: processedLocations.length,
        sample: processedLocations[0]
      }, '📍 Saving location batch to DB');

      const { data, error } = await supabaseAdmin
        .from('locations')
        .insert(processedLocations)
        .select();

      if (error) {
        fastify.log.error({ err: error }, '❌ Error inserting locations');
        return reply.code(500).send({ error: 'Failed to save locations' });
      }

      fastify.log.info({ inserted: data.length }, '✅ Locations saved successfully');

      return { 
        success: true, 
        inserted: data.length 
      };
    } catch (error) {
      fastify.log.error({ err: error }, 'Location batch error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Get user locations (with privacy filter)
  fastify.get('/locations/:userId', async (request, reply) => {
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

      // Check for blocks
      const { data: blockData } = await supabaseAdmin
        .from('blocks')
        .select('*')
        .or(`blocker_id.eq.${verified.userId},blocked_id.eq.${verified.userId}`)
        .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`)
        .limit(1);

      if (blockData && blockData.length > 0) {
        return reply.code(403).send({ error: 'User not accessible' });
      }

      // Get latest location (last 5 minutes)
      const { data, error } = await supabaseAdmin
        .from('locations')
        .select('latitude, longitude, recorded_at')
        .eq('user_id', userId)
        .gte('recorded_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
        .order('recorded_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        fastify.log.error({ err: error }, 'Error fetching location');
        return reply.code(500).send({ error: 'Failed to fetch location' });
      }

      return data || null;
    } catch (error) {
      fastify.log.error({ err: error }, 'Get location error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
