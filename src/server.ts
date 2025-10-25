import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import 'dotenv/config';

// Import routes
import { uploadRoutes } from './routes/upload';
import { profileRoutes } from './routes/profile';
import { locationRoutes } from './routes/location';
import { presenceRoutes } from './routes/presence';
import { conversationRoutes } from './routes/conversation';
import { blockRoutes } from './routes/block';
import { accountRoutes } from './routes/account';
import { nearbyRoutes } from './routes/nearby';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' 
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined
  }
});

async function start() {
  try {
    // Register CORS
    await fastify.register(cors, {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
      allowedHeaders: ['Content-Type', 'Authorization']
    });

    // Register rate limiting
    await fastify.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute'
    });

    // Register multipart support
    await fastify.register(multipart, {
      limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
      }
    });

    // Health check
    fastify.get('/health', async () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    });

    // Register routes
    await fastify.register(uploadRoutes, { prefix: '/api' });
    await fastify.register(profileRoutes, { prefix: '/api' });
    await fastify.register(locationRoutes, { prefix: '/api' });
    await fastify.register(presenceRoutes, { prefix: '/api' });
    await fastify.register(conversationRoutes, { prefix: '/api' });
    await fastify.register(blockRoutes, { prefix: '/api' });
    await fastify.register(accountRoutes, { prefix: '/api' });
    await fastify.register(nearbyRoutes, { prefix: '/api' });

    // Start server
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`Server listening on ${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
