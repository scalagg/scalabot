import { Client, Collection, REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config/config';

export class CommandLoaderService {
    private readonly client: Client;
    public readonly commands = new Collection<string, any>();

    constructor(client: Client) {
        this.client = client;
    }

    async loadCommands() {
        const commandsPath = join(__dirname, '..', 'commands');
        console.log('Loading commands from:', commandsPath);

        try {
            const commandFiles = readdirSync(commandsPath).filter(file => 
                file.endsWith('.ts') || file.endsWith('.js')
            );

            console.log('Found command files:', commandFiles);

            this.commands.clear();

            for (const file of commandFiles) {
                const filePath = join(commandsPath, file);
                console.log('Loading command file:', filePath);

                try {
                    const command = require(filePath);
                    console.log('Command data:', command?.data?.name);

                    if ('data' in command && 'execute' in command) {
                        this.commands.set(command.data.name, command);
                        console.log(`Successfully loaded command: ${command.data.name}`);
                    } else {
                        console.warn(`Command at ${filePath} is missing required properties`);
                        console.log('Command structure:', Object.keys(command));
                    }
                } catch (error) {
                    console.error(`Error loading command from ${filePath}:`, error);
                }
            }
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

            await rest.put(
                Routes.applicationCommands(this.client.user!.id),
                { body: commandsData }
            );

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