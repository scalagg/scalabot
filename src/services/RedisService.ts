import Redis from 'ioredis';
import type DiscordProfile from '../models/DiscordProfile';
import { config } from '../config/config';
import { sentryService } from './SentryService';

class RedisService {
    private redis: Redis;
    private isConnected: boolean = false;

    constructor() {
        // Log initial connection details
        console.log('Initializing Redis connection with:');
        console.log(`Host: ${config.redisHost}`);
        console.log(`Port: ${config.redisPort}`);
        console.log(`Password length: ${config.redisPassword?.length || 0} characters`);

        this.redis = new Redis({
            host: config.redisHost,
            port: config.redisPort,
            password: config.redisPassword,
            retryStrategy: (times) => {
                const delay = Math.min(times * 1000, 5000);
                console.log(`Retrying Redis connection in ${delay}ms... (Attempt ${times})`);
                return delay;
            },
            maxRetriesPerRequest: 3
        });

        this.setupEventHandlers();
    }

    private setupEventHandlers() {
        this.redis.on('connect', () => {
            console.log('Connected to Redis');
            this.isConnected = true;
        });

        this.redis.on('error', (error) => {
            console.error('Redis connection error:', error);
            sentryService.captureException(error as Error, {
                context: 'redis_connection_error'
            });
            this.isConnected = false;
        });

        this.redis.on('close', () => {
            console.log('Redis connection closed');
            this.isConnected = false;
        });

        this.redis.on('reconnecting', () => {
            console.log('Reconnecting to Redis...');
        });
    }

    private async ensureConnection(): Promise<void> {
        if (!this.isConnected) {
            throw new Error('Redis is not connected');
        }
    }

    async getSyncCode(code: string): Promise<string | null> {
        try {
            console.log(`Getting sync code for ${code}`);
            await this.ensureConnection();
            const result = await this.redis.get(`discord-sync-codes:codes:${code}`);
            console.log(`Sync code found for ${code}: ${result}`);
            return result;
        } catch (error) {
            console.error('Error getting sync code:', error);
            sentryService.captureException(error as Error, {
                context: 'redis_get_sync_code',
                code: code
            });
            return null;
        }
    }

    async storeSyncCode(code: string, uuid: string): Promise<void> {
        try {
            console.log(`Storing sync code for ${code} and ${uuid}`);
            await this.ensureConnection();
            await this.redis.set(`discord-sync-codes:codes:${code}`, uuid);
            await this.redis.set(`discord-sync-codes:accounts:${uuid}`, code);
            console.log(`Sync code stored for ${code} and ${uuid}`);
        } catch (error) {
            console.error('Error storing sync code:', error);
            sentryService.captureException(error as Error, {
                context: 'redis_store_sync_code',
                code: code,
                uuid: uuid
            });
            throw error;
        }
    }

    async deleteSyncCode(code: string, uuid: string): Promise<void> {
        try {
            console.log(`Deleting sync code for ${code} and ${uuid}`);
            await this.ensureConnection();
            await this.redis.del(`discord-sync-codes:codes:${code}`);
            await this.redis.del(`discord-sync-codes:accounts:${uuid}`);
            console.log(`Sync code deleted for ${code} and ${uuid}`);
        } catch (error) {
            console.error('Error deleting sync code:', error);
            throw error;
        }
    }

    async getProfile(uuid: string): Promise<DiscordProfile | null> {
        try {
            console.log(`Getting profile for ${uuid}`);
            await this.ensureConnection();
            const profile = await this.redis.get(`discord-profiles:${uuid}`);
            console.log(`Profile found for ${uuid}: ${profile}`);
            return profile ? JSON.parse(profile) : null;
        } catch (error) {
            console.error('Error getting profile:', error);
            return null;
        }
    }

    async saveProfile(profile: DiscordProfile): Promise<void> {
        try {
            console.log(`Saving profile for ${profile.identifier}`);
            await this.ensureConnection();
            await this.redis.set(
                `discord-profiles:${profile.identifier}`, 
                JSON.stringify(profile)
            );
            console.log(`Profile saved for ${profile.identifier}`);
        } catch (error) {
            console.error('Error saving profile:', error);
            throw error;
        }
    }

    async publish(channel: string, message: string): Promise<void> {
        try {
            console.log(`Publishing message to ${channel}: ${message}`);
            await this.ensureConnection();
            await this.redis.publish(channel, message);
            console.log(`Published message to ${channel}: ${message}`);
        } catch (error) {
            console.error('Error publishing message:', error);
            throw error;
        }
    }

    async quit(): Promise<void> {
        try {
            await this.redis.quit();
            console.log('Redis connection closed gracefully');
        } catch (error) {
            console.error('Error closing Redis connection:', error);
            this.redis.disconnect();
        }
    }

    getRedis(): Redis {
        return this.redis;
    }
}

export const redisService = new RedisService(); 