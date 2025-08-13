import { Client, Collection, REST, Routes } from 'discord.js';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { config } from '../config/config';

export class CommandLoaderService {
    private readonly client: Client;
    public readonly commands = new Collection<string, any>();
    private loadedPaths = new Set<string>(); // Track loaded files to prevent duplicates

    constructor(client: Client) {
        this.client = client;
    }

    private async loadCommandsFromDirectory(dirPath: string) {
        const items = readdirSync(dirPath);
        console.log(`Scanning directory: ${dirPath}`);
        console.log(`Found items: ${items.join(', ')}`);
        
        for (const item of items) {
            const fullPath = join(dirPath, item);
            const stat = statSync(fullPath);

            if (stat.isDirectory()) {
                console.log(`Entering subdirectory: ${fullPath}`);
                // Recursively load commands from subdirectories
                await this.loadCommandsFromDirectory(fullPath);
            } else if (stat.isFile() && (item.endsWith('.ts') || item.endsWith('.js'))) {
                // Skip if we've already loaded this file
                if (this.loadedPaths.has(fullPath)) {
                    console.log(`Skipping already loaded file: ${fullPath}`);
                    continue;
                }
                this.loadedPaths.add(fullPath);

                console.log('Loading command file:', fullPath);

                try {
                    const command = await import(fullPath);
                    console.log('Command module:', {
                        name: command?.data?.name,
                        hasData: 'data' in command,
                        hasExecute: 'execute' in command,
                        exports: Object.keys(command)
                    });

                    if ('data' in command && 'execute' in command) {
                        if (this.commands.has(command.data.name)) {
                            console.warn(`Command name conflict: ${command.data.name} is already registered`);
                            console.log('Existing command:', this.commands.get(command.data.name));
                            console.log('New command:', command);
                        }
                        this.commands.set(command.data.name, command);
                        console.log(`Successfully loaded command: ${command.data.name}`);
                    } else {
                        console.warn(`Command at ${fullPath} is missing required properties`);
                        console.log('Command structure:', {
                            keys: Object.keys(command),
                            data: command?.data,
                            execute: typeof command?.execute
                        });
                    }
                } catch (error) {
                    console.error(`Error loading command from ${fullPath}:`, error);
                }
            }
        }
    }

    async loadCommands() {
        const commandsPath = join(__dirname, '..', 'commands');
        console.log('Loading commands from:', commandsPath);
        this.loadedPaths.clear(); // Reset loaded paths tracking

        try {
            this.commands.clear();
            await this.loadCommandsFromDirectory(commandsPath);
            
            // Log final command list
            console.log('Final loaded commands:', {
                count: this.commands.size,
                commands: Array.from(this.commands.entries()).map(([name, cmd]) => ({
                    name,
                    path: this.loadedPaths.has(cmd.__filename) ? cmd.__filename : 'unknown'
                }))
            });
        } catch (error) {
            console.error('Error loading commands:', error);
            throw error;
        }
    }

    async registerCommands() {
        try {
            console.log('Started refreshing application (/) commands.');
            console.log('Loaded commands:', Array.from(this.commands.keys()));

            const rest = new REST().setToken(config.token);
            const commandsData = Array.from(this.commands.values()).map(cmd => cmd.data.toJSON());

            console.log('Registering commands:', commandsData);

            // If testGuildId is set, register commands to that guild first
            if (config.testGuildId) {
                console.log(`Registering commands to test guild: ${config.testGuildId}`);
                await rest.put(
                    Routes.applicationGuildCommands(this.client.user!.id, config.testGuildId),
                    { body: commandsData }
                );
            } else {
                // Register commands globally
                await rest.put(
                    Routes.applicationCommands(this.client.user!.id),
                    { body: commandsData }
                );
            }

            console.log('Successfully reloaded application (/) commands.');
        } catch (error) {
            console.error('Error while reloading commands:', error);
            throw error;
        }
    }

    async initialize() {
        await this.loadCommands();
        // Only register commands once the client is ready
        if (this.client.isReady()) {
            await this.registerCommands();
        } else {
            this.client.once('ready', async () => {
                await this.registerCommands();
            });
        }
    }

    getCommand(name: string) {
        return this.commands.get(name);
    }
} 