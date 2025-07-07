import { 
    SlashCommandBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ChatInputCommandInteraction,
    PermissionFlagsBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ModalSubmitInteraction,
    GuildMember,
    ButtonInteraction,
    TextChannel
} from 'discord.js';
import type { InteractionReplyOptions } from 'discord.js';
import { redisService } from '../services/RedisService';
import { mongoService } from '../services/MongoService';
import { getMinecraftUsername } from '../utils/minecraftUtils';
import { PunishmentService } from '../services/PunishmentService';
import { welcomeService } from '../services/WelcomeService';

interface DiscordProfile {
    _id: string;
    claimedInitialLinkAward: boolean;
    completedInitialSave: boolean | null;
    discordId: string | null;
    identifier: string;
    lastCachedDiscordUsername: string | null;
    notifiedOfSuccessfulLink: boolean;
}

interface MojangProfile {
    id: string;
    name: string;
    properties: Array<{
        name: string;
        value: string;
    }>;
}

export const data = new SlashCommandBuilder()
    .setName('deployverify')
    .setDescription('Deploy the verification panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
    console.log('[DiscordBot] [DEBUG] Deploying verification panel...');
    
    if (!interaction.channel || !(interaction.channel instanceof TextChannel)) {
        console.log('[DiscordBot] [ERROR] Command used in non-text channel');
        await interaction.reply({
            content: '❌ This command can only be used in text channels!',
            flags: 1 << 6
        });
        return;
    }

    // Create verification embed
    const embed = new EmbedBuilder()
        .setColor('#2F3136')
        .setTitle('🔐 Minecraft Account Verification')
        .setDescription('Welcome to the server! To gain access, you need to verify your Minecraft account.')
        .addFields(
            { 
                name: '📝 How to Verify', 
                value: '1. Join the Minecraft server\n2. Type `/sync` in-game\n3. Click the verify button below\n4. Enter your verification code' 
            },
            { 
                name: '❓ Need Help?', 
                value: 'If you need assistance, please contact a staff member.' 
            }
        )
        .setFooter({ text: 'Verification is required to access the server' });

    // Create verify button
    const verifyButton = new ButtonBuilder()
        .setCustomId('verify-button')
        .setLabel('Verify Account')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔑');

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(verifyButton);

    console.log('[DiscordBot] [DEBUG] Sending verification panel to channel:', interaction.channel.id);
    
    // Send the verification panel
    await interaction.channel.send({
        embeds: [embed],
        components: [row]
    });

    // Confirm to admin
    await interaction.reply({
        content: '✅ Verification panel has been deployed!',
        flags: 1 << 6
    });
    
    console.log('[DiscordBot] [DEBUG] Verification panel deployed successfully');
}

export async function handleButton(interaction: ButtonInteraction) {
    console.log('[DiscordBot] [DEBUG] Button interaction received:', {
        customId: interaction.customId,
        userId: interaction.user.id,
        username: interaction.user.tag
    });

    try {
        if (interaction.customId === 'verify-button') {
            console.log('[DiscordBot] [DEBUG] Creating verification modal...');
            
            // Show the verification modal
            const modal = new ModalBuilder()
                .setCustomId('verify-modal')
                .setTitle('Minecraft Account Verification');

            const codeInput = new TextInputBuilder()
                .setCustomId('code')
                .setLabel('Verification Code')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Enter the code from /sync command')
                .setMinLength(6)
                .setMaxLength(7)
                .setRequired(true);

            const actionRow = new ActionRowBuilder<TextInputBuilder>()
                .addComponents(codeInput);

            modal.addComponents(actionRow);
            
            console.log('[DiscordBot] [DEBUG] Showing verification modal to user:', interaction.user.tag);
            await interaction.showModal(modal);
            console.log('[DiscordBot] [DEBUG] Modal shown successfully');
        } else {
            console.log('[DiscordBot] [WARN] Unknown button interaction:', interaction.customId);
        }
    } catch (error) {
        console.error('[DiscordBot] [ERROR] Failed to handle button interaction:', error);
        await interaction.reply({
            content: '❌ An error occurred while processing your request. Please try again.',
            flags: 1 << 6
        });
    }
}

export async function handleModal(interaction: ModalSubmitInteraction) {
    console.log('[DiscordBot] [DEBUG] Modal submission received from user:', interaction.user.tag);
    
    try {
        const code = interaction.fields.getTextInputValue('code');
        console.log('[DiscordBot] [DEBUG] Processing verification code for user:', interaction.user.tag);
        
        const uuid = await redisService.getSyncCode(code);
        if (!uuid) {
            console.log('[DiscordBot] [WARN] Invalid verification code provided by user:', interaction.user.tag);
            await interaction.reply({
                content: '❌ Invalid verification code. Please make sure you entered the correct code from the `/sync` command.',
                flags: 1 << 6
            });
            return;
        }

        console.log('[DiscordBot] [DEBUG] Valid code found for UUID:', uuid);
        
        // Check if user can verify
        const punishmentService = PunishmentService.getInstance();
        const verificationStatus = await punishmentService.canVerify(uuid);
        if (!verificationStatus.canVerify) {
            const expiryText = verificationStatus.expiryTimestamp
                ? `\nYour ban will expire <t:${verificationStatus.expiryTimestamp}:R>`
                : '\nThis is a permanent ban';

            await interaction.reply({
                content: `❌ You cannot verify while banned.\nReason: ${verificationStatus.reason}${expiryText}`,
                flags: 1 << 6
            });
            return;
        }

        // Get Minecraft username from UUID
        const minecraftUsername = await getMinecraftUsername(uuid);
        console.log('[DiscordBot] [DEBUG] Fetched Minecraft username:', minecraftUsername);
        
        // Connect to MongoDB and get profiles collection
        await mongoService.connect();
        const profiles = mongoService.getCollection<DiscordProfile>('DiscordProfile');

        // Get or create profile from MongoDB
        let profile = await profiles.findOne({ identifier: uuid });
        if (!profile) {
            console.log('[DiscordBot] [DEBUG] Creating new profile for UUID:', uuid);
            profile = {
                _id: uuid,
                claimedInitialLinkAward: false,
                completedInitialSave: false,
                discordId: null,
                identifier: uuid,
                lastCachedDiscordUsername: null,
                notifiedOfSuccessfulLink: false
            } as DiscordProfile;
        }

        // Update profile
        profile.discordId = interaction.user.id;
        profile.lastCachedDiscordUsername = minecraftUsername;
        profile.notifiedOfSuccessfulLink = true;

        console.log('[DiscordBot] [DEBUG] Updating profile in MongoDB:', {
            uuid,
            discordId: interaction.user.id,
            minecraftUsername: minecraftUsername,
            notifiedOfSuccessfulLink: true
        });

        // Save to MongoDB
        await profiles.updateOne(
            { identifier: uuid },
            { $set: profile },
            { upsert: true }
        );

        // Clean up sync code
        await redisService.deleteSyncCode(code, uuid);

        // Publish account link notification using Aware message format
        const awareMessage = {
            packetId: 'linked',
            type: 'linked',
            data: {
                'player-uuid': uuid,
                'discord-username': interaction.user.tag,
                'minecraft-username': minecraftUsername
            }
        };
        
        console.log('[DiscordBot] [DEBUG] Publishing account link notification');
        
        try {
            await redisService.publish('discord', JSON.stringify(awareMessage));
            console.log('[DiscordBot] [DEBUG] Message published successfully');
        } catch (error) {
            console.error('[DiscordBot] [ERROR] Failed to publish message:', error);
            throw error;
        }

        // Add role and set nickname
        if (interaction.guild && interaction.member instanceof GuildMember) {
            const verifiedRole = interaction.guild.roles.cache.find(
                role => role.name === 'Member'
            );
            
            if (verifiedRole) {
                console.log('[DiscordBot] [DEBUG] Adding verified role to user:', interaction.user.tag);
                await interaction.member.roles.add(verifiedRole);
                await interaction.member.setNickname(minecraftUsername);
            }

            // Update roles based on punishment status
            await punishmentService.updateMemberRoles(interaction.member, uuid);
        }

        // Send success message
        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Verification Successful')
            .setDescription(`Your Minecraft account has been successfully verified!\n\nYou now have access to the server.`)
            .addFields(
                { name: 'Minecraft Username', value: minecraftUsername, inline: true },
                { name: 'Discord Username', value: interaction.user.tag, inline: true }
            )
            .setFooter({ text: 'Welcome to the server!' });

        await interaction.reply({
            embeds: [successEmbed],
            flags: 1 << 6
        });

        // Send welcome message after successful verification
        if (interaction.guild && interaction.member instanceof GuildMember) {
            try {
                console.log('[DiscordBot] [DEBUG] Sending welcome message for verified user:', interaction.user.tag);
                await welcomeService.handleVerificationWelcome(interaction.member, minecraftUsername, uuid);
                console.log('[DiscordBot] [DEBUG] Welcome message sent successfully');
            } catch (welcomeError) {
                console.error('[DiscordBot] [ERROR] Failed to send welcome message:', welcomeError);
                // Don't fail the verification if welcome message fails
            }
        }

        console.log('[DiscordBot] [DEBUG] Verification completed successfully for user:', interaction.user.tag, 'with UUID:', uuid, 'and Minecraft Username:', minecraftUsername);

    } catch (error) {
        console.error('[DiscordBot] [ERROR] Error handling verification:', error);
        const errorEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ Verification Failed')
            .setDescription('An error occurred while processing your verification. Please try again later or contact a staff member.')
            .setFooter({ text: 'If this persists, please contact staff.' });

        await interaction.reply({
            embeds: [errorEmbed],
            flags: 1 << 6
        });
    }
} 