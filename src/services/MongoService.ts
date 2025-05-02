import { MongoClient, Collection, Db } from 'mongodb';
import { config } from '../config/config';

export class MongoService {
    private static instance: MongoService;
    private client: MongoClient;
    private db: Db;

    private constructor() {
        this.client = new MongoClient(config.mongoUri);
    }

    public static getInstance(): MongoService {
        if (!MongoService.instance) {
            MongoService.instance = new MongoService();
        }
        return MongoService.instance;
    }

    public async connect(): Promise<void> {
        if (!this.db) {
            await this.client.connect();
            this.db = this.client.db(config.mongoDbName); // Using exact case as existing DB
        }
    }

    public async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.close();
        }
    }

    public getCollection<T>(collectionName: string): Collection<T> {
        if (!this.db) {
            throw new Error('Database not connected. Call connect() first.');
        }
        return this.db.collection<T>(collectionName);
    }
}

export const mongoService = MongoService.getInstance(); 