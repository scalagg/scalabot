declare module 'minecraft-status' {
    interface MinecraftServerListPing {
        static ping(version: number, host: string, port: number, timeout: number): Promise<{
            version: {
                name: string;
                protocol: number;
            };
            players: {
                max: number;
                online: number;
                sample?: Array<{
                    name: string;
                    id: string;
                }>;
            };
            description: string | {
                text?: string;
                extra?: Array<{
                    text?: string;
                    color?: string;
                    bold?: boolean;
                    italic?: boolean;
                    underlined?: boolean;
                    strikethrough?: boolean;
                    obfuscated?: boolean;
                }>;
            };
            favicon?: string;
        }>;
    }

    const MinecraftServerListPing: MinecraftServerListPing;
    export = MinecraftServerListPing;
} 