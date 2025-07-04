import { 
    Client, 
    GatewayIntentBits, 
    Events, 
    EmbedBuilder,
    ButtonInteraction,
    ModalSubmitInteraction,
    StringSelectMenuInteraction,
    TextChannel
} from 'discord.js';
import type { 
    Interaction,
    ChatInputCommandInteraction
} from 'discord.js';
import { config } from './config/config';
import { CommandLoaderService } from './services/CommandLoaderService';
import { handleTicketButton } from './handlers/TicketButtonHandler';
import { handleModal as handleTicketModal } from './handlers/TicketModalHandler';
import { 
    handleTicketManagement,
    handleCloseConfirmation,
    handleRating 
} from './handlers/TicketManagementHandler';
import { mongoService } from './services/MongoService';
import { ticketService } from './services/TicketService';
import { transcriptService } from './services/TranscriptService';
import { serverUtils } from './utils/ServerUtils';

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Initialize command loader
const commandLoader = new CommandLoaderService(client);

// Initialize ticket service with client
ticketService.setClient(client);

// Track initialization status
let isInitialized = false;

// Handle ready event
client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}!`);

    try {
        // Initialize services in sequence
        console.log('Initializing services...');
        
        // 1. Connect to MongoDB first
        await mongoService.connect();
        console.log('Connected to MongoDB');

        // 2. Initialize ticket service
        await ticketService.initialize();
        console.log('Ticket service initialized');

        // 3. Initialize commands last
        await commandLoader.initialize();
        console.log('Commands initialized');

        // Mark as initialized
        isInitialized = true;
        console.log('All services initialized successfully');
    } catch (error) {
        console.error('Error during initialization:', error);
        process.exit(1); // Exit if initialization fails
    }
});

// Handle interactions
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
        // Check if services are initialized
        if (!isInitialized) {
            if (interaction.isRepliable()) {
                await interaction.reply({
                    content: '❌ Bot is still initializing. Please try again in a moment.',
                    flags: 1 << 6
                });
            }
            return;
        }

        if (interaction.isCommand()) {
            const command = commandLoader.getCommand(interaction.commandName);
            if (!command) {
                console.error(`Command ${interaction.commandName} not found`);
                return;
            }

            await command.execute(interaction);
        }
        else if (interaction.isButton()) {
            const customId = interaction.customId;
            console.log('[DEBUG] Button interaction:', customId);

            // Handle ticket creation buttons
            if (customId.startsWith('ticket_') && ['general', 'staff', 'buycraft', 'punishments'].some(type => customId === `ticket_${type}`)) {
                await handleTicketButton(interaction);
            }
            // Handle close confirmation buttons
            else if (customId.startsWith('ticket_close_')) {
                await handleCloseConfirmation(interaction);
            }
            // Handle rating buttons
            else if (customId.startsWith('ticket_rate_')) {
                await handleRating(interaction);
            }
            // Handle other ticket-related buttons
            else if (customId.startsWith('ticket_')) {
                await handleTicketManagement(interaction);
            }
        }
        else if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('ticket-')) {
                await handleTicketModal(interaction);
            }
        }
        else if (interaction.isStringSelectMenu()) {
            // Handle any select menu interactions here if needed
            console.log('[DEBUG] Select menu interaction:', interaction.customId);
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        
        const errorMessage = {
            content: 'An error occurred while processing your request.',
            flags: 1 << 6
        };

        if (interaction.isRepliable() && !interaction.replied) {
            await interaction.reply(errorMessage);
        } else if (interaction.isRepliable()) {
            await interaction.followUp(errorMessage);
        }
    }
});

// Handle guild member remove event (user leaves server)
client.on(Events.GuildMemberRemove, async (member) => {
    try {
        // Check if services are initialized
        if (!isInitialized) {
            console.log('Skipping member remove handler - services not initialized');
            return;
        }

        // Set server type based on guild ID
        serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(member.guild.id));

        // Find all open tickets by this user
        const tickets = await ticketService.getUserTickets(member.id, member.guild.id, ['OPEN', 'RATING']);

        for (const ticket of tickets) {
            const channel = member.guild.channels.cache.get(ticket.channelId);
            if (channel?.isTextBased() && channel instanceof TextChannel) {
                const embed = new EmbedBuilder()
                    .setColor(serverUtils.getColor('error'))
                    .setTitle('The Ticket author has left the server!')
                    .setDescription(`This ticket will be closed automatically due to the author leaving the server. However, the channel was not deleted automatically to prevent destructive action. This channel **can be deleted at any time by any staff member using the button below.**`)
                    .setFooter(serverUtils.getFooter())
                    .setTimestamp();

                await channel.send({ embeds: [embed] });

                // Save transcript and close ticket
                await transcriptService.saveTranscript(
                    channel, 
                    'SYSTEM',
                    ticket,
                    'User left the server'
                );
                await ticketService.closeTicket(ticket._id!, 'SYSTEM');

                // Delete channel after delay
                setTimeout(() => channel.delete(), 5000);
            }
        }
    } catch (error) {
        console.error('Error handling member remove:', error);
    }
});

// Login to Discord
client.login(config.token);