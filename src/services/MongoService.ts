import mongoose from 'mongoose';
import type { Collection, Document } from 'mongodb';
import { config } from '../config/config';
import { sentryService } from './SentryService';

class MongoService {
    private static instance: MongoService;
    private isConnected: boolean = false;
    private connectionPromise: Promise<typeof mongoose> | null = null;

    private constructor() {}

    public static getInstance(): MongoService {
        if (!MongoService.instance) {
            MongoService.instance = new MongoService();
        }
        return MongoService.instance;
    }

    public async connect(): Promise<void> {
        if (this.isConnected) {
            console.log('[MongoDB] Already connected');
            return;
        }

        if (this.connectionPromise) {
            console.log('[MongoDB] Connection in progress, waiting...');
            await this.connectionPromise;
            return;
        }

        try {
            console.log('[MongoDB] Connecting to database...');
            
            // Set Mongoose options
            mongoose.set('strictQuery', true);

            // Create connection promise
            this.connectionPromise = mongoose.connect(config.mongoUri, {
                serverSelectionTimeoutMS: 5000, // Reduce from default 30s to 5s
                connectTimeoutMS: 10000,
                socketTimeoutMS: 45000,
            });

            // Wait for connection
            await this.connectionPromise;
            
            this.isConnected = true;
            console.log('[MongoDB] Connected successfully');

            // Handle connection errors
            mongoose.connection.on('error', (error) => {
                console.error('[MongoDB] Connection error:', error);
                sentryService.captureException(error as Error, {
                    context: 'mongodb_connection_error'
                });
                this.isConnected = false;
            });

            mongoose.connection.on('disconnected', () => {
                console.log('[MongoDB] Disconnected from database');
                this.isConnected = false;
            });

        } catch (error) {
            console.error('[MongoDB] Connection failed:', error);
            sentryService.captureException(error as Error, {
                context: 'mongodb_connection',
                mongo_uri: config.mongoUri ? 'present' : 'missing'
            });
            this.connectionPromise = null;
            this.isConnected = false;
            throw error;
        }
    }

    public getCollection<T extends { _id: string }>(name: string): Collection<T & Document> {
        if (!this.isConnected) {
            throw new Error('MongoDB not connected. Call connect() first.');
        }
        return mongoose.connection.collection(name);
    }

    public isConnectedToMongo(): boolean {
        return this.isConnected;
    }
}

export const mongoService = MongoService.getInstance(); 