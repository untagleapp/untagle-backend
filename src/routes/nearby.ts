import { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';

export async function nearbyRoutes(fastify: FastifyInstance) {
    // Get nearby users based on location and radius
    fastify.get('/api/users/nearby', async (request, reply) => {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.code(401).send({ error: 'Missing or invalid authorization header' });
        }

        const token = authHeader.substring(7);
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

        if (authError || !user) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }

        const { lat, lon, radius } = request.query as { lat?: string; lon?: string; radius?: string };

        if (!lat || !lon || !radius) {
            return reply.code(400).send({ error: 'Missing required query params: lat, lon, radius' });
        }

        const latitude = parseFloat(lat);
        const longitude = parseFloat(lon);
        const radiusKm = parseFloat(radius);

        if (isNaN(latitude) || isNaN(longitude) || isNaN(radiusKm)) {
            return reply.code(400).send({ error: 'Invalid lat, lon, or radius' });
        }

        if (radiusKm < 0 || radiusKm > 5) {
            return reply.code(400).send({ error: 'Radius must be between 0 and 5 km' });
        }

        fastify.log.info({
            requestingUserId: user.id,
            latitude,
            longitude,
            radiusKm
        }, '🔍 Nearby users request');

        try {
            // Get blocked users (both directions)
            const { data: blocks } = await supabaseAdmin
                .from('blocks')
                .select('blocked_id, blocker_id')
                .or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`);

            const blockedUserIds = new Set<string>();
            if (blocks) {
                blocks.forEach((block: any) => {
                    if (block.blocker_id === user.id) {
                        blockedUserIds.add(block.blocked_id);
                    } else {
                        blockedUserIds.add(block.blocker_id);
                    }
                });
            }

            fastify.log.info({ blockedCount: blockedUserIds.size }, '🚫 Blocked users loaded');

            // Get users who are online (last_active_at within 2 minutes)
            const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

            fastify.log.info({ twoMinutesAgo }, '⏰ Querying online users since');

            const { data: onlineUsers, error: usersError } = await supabaseAdmin
                .from('users')
                .select('id, name, email, profile_image_url, presence_status')
                .eq('presence_status', 'online')
                .gte('last_active_at', twoMinutesAgo)
                .neq('id', user.id); // Exclude self

            if (usersError) {
                fastify.log.error({ err: usersError }, '❌ Error fetching users');
                return reply.code(500).send({ error: 'Failed to fetch users' });
            }

            fastify.log.info({ onlineUsersCount: onlineUsers?.length || 0 }, '👥 Online users found');

            if (!onlineUsers || onlineUsers.length === 0) {
                fastify.log.info('No online users found');
                return reply.send({ users: [] });
            }

            // Filter out blocked users
            const availableUsers = onlineUsers.filter(u => !blockedUserIds.has(u.id));

            fastify.log.info({ availableUsersCount: availableUsers.length }, '✅ Available users (after blocking filter)');

            if (availableUsers.length === 0) {
                return reply.send({ users: [] });
            }

            // Get recent locations for these users (within last 5 minutes)
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            const userIds = availableUsers.map(u => u.id);

            fastify.log.info({ 
                fiveMinutesAgo,
                userIds 
            }, '📍 Querying locations for users');

            const { data: locations, error: locError } = await supabaseAdmin
                .from('locations')
                .select('user_id, latitude, longitude, recorded_at')
                .in('user_id', userIds)
                .gte('recorded_at', fiveMinutesAgo)
                .order('recorded_at', { ascending: false });

            if (locError) {
                fastify.log.error({ err: locError }, '❌ Error fetching locations');
                return reply.code(500).send({ error: 'Failed to fetch locations' });
            }

            fastify.log.info({ 
                locationsCount: locations?.length || 0,
                locations: locations?.slice(0, 5) // Log first 5 for debugging
            }, '📍 Locations found');

            // Get most recent location per user
            const userLocations = new Map<string, { lat: number; lon: number }>();
            if (locations) {
                locations.forEach((loc: any) => {
                    if (!userLocations.has(loc.user_id)) {
                        userLocations.set(loc.user_id, {
                            lat: parseFloat(loc.latitude),
                            lon: parseFloat(loc.longitude)
                        });
                    }
                });
            }

            fastify.log.info({ usersWithLocations: userLocations.size }, '📍 Users with recent locations');

            // Calculate distance using Haversine formula
            const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
                const R = 6371; // Earth radius in km
                const dLat = (lat2 - lat1) * Math.PI / 180;
                const dLon = (lon2 - lon1) * Math.PI / 180;
                const a =
                    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                return R * c;
            };

            // Filter users within radius and add distance
            const nearbyUsers = availableUsers
                .map(u => {
                    const userLoc = userLocations.get(u.id);
                    if (!userLoc) {
                        fastify.log.debug({ userId: u.id }, '⚠️ User has no recent location');
                        return null;
                    }

                    const distance = haversineDistance(latitude, longitude, userLoc.lat, userLoc.lon);

                    fastify.log.debug({
                        userId: u.id,
                        userName: u.name,
                        distance: distance.toFixed(3) + 'km',
                        userLocation: userLoc,
                        withinRadius: distance <= radiusKm
                    }, '📏 Distance calculated');

                    if (distance <= radiusKm) {
                        return {
                            id: u.id,
                            name: u.name || u.email.split('@')[0],
                            profile_image_url: u.profile_image_url,
                            distance_km: Math.round(distance * 100) / 100 // Round to 2 decimals
                        };
                    }
                    return null;
                })
                .filter(u => u !== null)
                .sort((a, b) => a!.distance_km - b!.distance_km) // Sort by distance
                .slice(0, 50); // Limit to 50 users

            fastify.log.info({ 
                nearbyUsersCount: nearbyUsers.length,
                nearbyUsers: nearbyUsers.slice(0, 5) // Log first 5
            }, '✅ Nearby users result');

            return reply.send({ users: nearbyUsers });

        } catch (error: any) {
            fastify.log.error({ err: error }, 'Error in nearby users endpoint');
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });
}
