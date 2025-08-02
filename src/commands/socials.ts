import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    EmbedBuilder,
    AutocompleteInteraction,
    AttachmentBuilder
} from 'discord.js';
import { serverUtils } from '../utils/ServerUtils';
import { config } from '../config/config';
import { verifyMinecraftUsername } from '../utils/minecraftUtils';
import { createCanvas, loadImage, registerFont } from 'canvas';
import path from 'path';

// Register fonts
registerFont(path.join(process.cwd(), 'assets', 'fonts', 'Roboto-Regular.ttf'), { family: 'Roboto' });
registerFont(path.join(process.cwd(), 'assets', 'fonts', 'Roboto-Bold.ttf'), { family: 'Roboto Bold' });

interface PlayerSocials {
    [key: string]: string;
}

interface PlayerSearchResult {
    uuid: string;
    username: string;
}

export const data = new SlashCommandBuilder()
    .setName('socials')
    .setDescription('Get a player\'s social media links')
    .addStringOption(option =>
        option
            .setName('player')
            .setDescription('The player to get socials for')
            .setRequired(true)
            .setAutocomplete(true)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
        const playerName = interaction.options.getString('player', true);
        
        // First, verify the Minecraft username and get UUID using PlayerDB
        console.log('[Socials Command] Looking up UUID for player:', playerName);
        
        const verification = await verifyMinecraftUsername(playerName);
        console.log('[Socials Command] Verification result:', verification);
        
        if (!verification.isValid || !verification.uuid) {
            return await interaction.editReply({
                content: '❌ Player not found. Please check the username and try again.'
            });
        }

        const player = {
            uuid: verification.uuid,
            username: verification.username || playerName
        };
        
        // Now fetch the player's socials using their UUID
        const socialsUrl = serverUtils.getConnectionsEndpoint(player.uuid);
        console.log('[Socials Command] Fetching socials from:', socialsUrl);
        console.log('[Socials Command] Using API key:', config.apiKey ? 'Present' : 'Missing');
        
        const socialsResponse = await fetch(socialsUrl, {
            headers: {
                'Authorization': config.apiKey,
                'Content-Type': 'application/json'
            }
        });

        console.log('[Socials Command] Socials response status:', socialsResponse.status);
        console.log('[Socials Command] Socials response ok:', socialsResponse.ok);

        if (!socialsResponse.ok) {
            const errorText = await socialsResponse.text();
            console.log('[Socials Command] Socials error response:', errorText);
            return await interaction.editReply({
                content: '❌ Failed to fetch player socials. The player might not have any social media linked.'
            });
        }

        const socials: PlayerSocials = await socialsResponse.json();
        console.log('[Socials Command] Raw socials data:', socials);
        
        // Filter out empty socials and the "null" key
        const validSocials = Object.entries(socials)
            .filter(([key, value]) => key !== 'null' && value && value.trim() !== '')
            .reduce((acc, [key, value]) => {
                acc[key] = value;
                return acc;
            }, {} as PlayerSocials);
        
        console.log('[Socials Command] Valid socials:', validSocials);

        if (Object.keys(validSocials).length === 0) {
            return await interaction.editReply({
                content: `❌ **${player.username}** doesn't have any social media linked to their account.`
            });
        }

        // Create embed with socials
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('info'))
            .setTitle(`📱 ${player.username}'s Social Media`)
            .setDescription(`Here are the social media links for **${player.username}**:`)
            .setFooter({ text: `*Tip: You can set your socials in game via the /profile command and going to the book and quill.*`, iconURL: interaction.user.displayAvatarURL() })
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        // Add social media fields
        for (const [platform, username] of Object.entries(validSocials)) {
            const platformIcon = getPlatformIcon(platform);
            const platformUrl = getPlatformUrl(platform, username);
            
            embed.addFields({
                name: `${platformIcon} ${platform}`,
                value: platformUrl ? `[${username}](${platformUrl})` : username,
                inline: true
            });
        }

        // Create social media canvas
        const socialsCanvas = await createSocialsCanvas(player.username, player.uuid, validSocials);
        const attachment = new AttachmentBuilder(socialsCanvas, { name: 'socials.png' });
        
        embed.setImage('attachment://socials.png');

        await interaction.editReply({ embeds: [embed], files: [attachment] });

    } catch (error) {
        console.error('[Socials Command] Error:', error);
        await interaction.editReply({
            content: '❌ An error occurred while fetching player socials. Please try again later.'
        });
    }
}

export async function autocomplete(interaction: AutocompleteInteraction) {
    try {
        const focusedValue = interaction.options.getFocused();
        
        if (!focusedValue || focusedValue.length < 2) {
            await interaction.respond([]);
            return;
        }

        // For now, just return the typed value as a suggestion
        // In the future, we could implement a local cache of known players
        // or use a different approach for autocomplete
        await interaction.respond([
            {
                name: focusedValue,
                value: focusedValue
            }
        ]);

    } catch (error) {
        console.error('[Socials Autocomplete] Error:', error);
        await interaction.respond([]);
    }
}

async function createSocialsCanvas(username: string, uuid: string, socials: PlayerSocials): Promise<Buffer> {
    const canvas = createCanvas(800, 400);
    const ctx = canvas.getContext('2d');

    // Load background image
    const bgImage = await loadImage(path.join(process.cwd(), 'assets', 'images', 'scala-bg.png'));
    
    // Draw semi-transparent background
    ctx.globalAlpha = 0.3;
    ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1.0;

    // Add a semi-transparent dark overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Load player skin
    try {
        const skinImage = await loadImage(`https://skins.mcstats.com/bust/${uuid}`);

        // Draw player head in top-left corner
        ctx.save();
        ctx.beginPath();
        ctx.arc(100, 100, 60, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(skinImage, 40, 40, 120, 120);
        ctx.restore();
        
        // Add border to player head
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(100, 100, 60, 0, Math.PI * 2);
        ctx.stroke();
    } catch (error) {
        console.error('[Socials Canvas] Failed to load player skin:', error);
    }

    // Draw title
    ctx.font = 'bold 32px "Roboto Bold"';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.fillText(`${username}'s Social Media`, canvas.width / 2, 80);

    // Draw social media platforms
    const socialEntries = Object.entries(socials);
    const startY = 260;
    const spacing = 60;
    const itemsPerRow = 3;

    ctx.textAlign = 'left';
    ctx.shadowBlur = 2;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;

    socialEntries.forEach(([platform, username], index) => {
        const row = Math.floor(index / itemsPerRow);
        const col = index % itemsPerRow;
        const x = 50 + col * 250;
        const y = startY + row * spacing;

        // Platform icon
        const icon = getPlatformIcon(platform);
        ctx.font = '24px "Roboto"';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(icon, x, y);

        // Platform name
        ctx.font = 'bold 18px "Roboto Bold"';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(platform, x + 35, y - 5);

        // Username
        ctx.font = '16px "Roboto"';
        ctx.fillStyle = '#CCCCCC';
        ctx.fillText(username, x + 35, y + 10);
    });

    return canvas.toBuffer();
}

function getPlatformIcon(platform: string): string {
    const icons: { [key: string]: string } = {
        'Discord': '🎮',
        'Twitter': '🐦',
        'GitHub': '💻',
        'YouTube': '📺',
        'Telegram': '📱'
    };
    
    return icons[platform] || '🔗';
}

function getPlatformUrl(platform: string, username: string): string | null {
    const urls: { [key: string]: string } = {
        'Discord': `https://discord.com/users/${username}`,
        'Twitter': `https://twitter.com/${username}`,
        'GitHub': `https://github.com/${username}`,
        'YouTube': `https://youtube.com/@${username}`,
        'Telegram': `https://t.me/${username}`
    };
    
    return urls[platform] || null;
} 