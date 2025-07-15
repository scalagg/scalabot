import { Schema, model } from 'mongoose';

export interface Counter {
    _id: string;
    sequence: number;
}

const counterSchema = new Schema<Counter>({
    _id: { type: String, required: true },
    sequence: { type: Number, default: 0 }
});

export const CounterModel = model<Counter>('Counter', counterSchema); 