import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import type { Interaction } from 'discord.js';
import { WelcomeCanvas } from './libs/welcomeCanvas';
import { config } from './config/config';
import { CommandLoaderService } from './services/CommandLoaderService';
import { redisService } from './services/RedisService';

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Get WelcomeCanvas instance
const welcomeCanvas = WelcomeCanvas.getInstance();

// Initialize command loader
const commandLoader = new CommandLoaderService(client);

// Handle guild member join
client.on('guildMemberAdd', async (member) => {
  try {
    const welcomeChannel = member.guild.channels.cache.get(config.welcomeChannelId) as TextChannel;
    if (!welcomeChannel) return;

    // Create welcome image with config settings
    const welcomeImage = await welcomeCanvas.createCustomWelcomeImage(member, config.welcomeImageConfig);

    await welcomeChannel.send({
      content: `Welcome ${member} to the server!`,
      files: [{ attachment: welcomeImage, name: 'welcome.png' }]
    });
  } catch (error) {
    console.error('Error handling welcome message:', error);
  }
});

// Handle command interactions
client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isCommand() && !interaction.isModalSubmit()) return;

  try {
    if (interaction.isCommand()) {
      const command = commandLoader.getCommand(interaction.commandName);
      if (!command) return;

      await command.execute(interaction);
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId === 'sync-modal') {
        const syncCommand = commandLoader.getCommand('sync');
        if (!syncCommand) return;

        await syncCommand.handleModal(interaction);
      }
    }
  } catch (error) {
    console.error('Error executing command:', error);
    const reply = {
      content: 'There was an error while executing this command!',
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

// Handle ready event
client.once('ready', () => {
  console.log(`Logged in as ${client.user?.tag}`);
});

// Initialize commands and login
async function start() {
  try {
    await commandLoader.initialize();
    await client.login(config.token);
  } catch (error) {
    console.error('Error starting bot:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await Promise.all([
    client.destroy(),
    redisService.quit()
  ]);
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  await Promise.all([
    client.destroy(),
    redisService.quit()
  ]);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (error) => {
  console.error('Unhandled promise rejection:', error);
  await Promise.all([
    client.destroy(),
    redisService.quit()
  ]);
  process.exit(1);
});

// Start the bot
start();