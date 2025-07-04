import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { serverUtils, ServerType } from '../utils/ServerUtils';
import { pingServer } from '../utils/minecraftUtils';
import { createCanvas, loadImage, registerFont } from 'canvas';
import path from 'path';

// Register fonts
registerFont(path.join(process.cwd(), 'assets', 'fonts', 'Roboto-Regular.ttf'), { family: 'Roboto' });
registerFont(path.join(process.cwd(), 'assets', 'fonts', 'Roboto-Bold.ttf'), { family: 'Roboto Bold' });

// Minecraft color codes to hex
const MINECRAFT_COLORS: { [key: string]: string } = {
    '0': '#000000', // Black
    '1': '#0000AA', // Dark Blue
    '2': '#00AA00', // Dark Green
    '3': '#00AAAA', // Dark Aqua
    '4': '#AA0000', // Dark Red
    '5': '#AA00AA', // Dark Purple
    '6': '#FFAA00', // Gold
    '7': '#AAAAAA', // Gray
    '8': '#555555', // Dark Gray
    '9': '#5555FF', // Blue
    'a': '#55FF55', // Green
    'b': '#55FFFF', // Aqua
    'c': '#FF5555', // Red
    'd': '#FF55FF', // Light Purple
    'e': '#FFFF55', // Yellow
    'f': '#FFFFFF', // White
};

interface TextSegment {
    text: string;
    color?: string;
    bold?: boolean;
}

function parseHtmlMotd(html: string): TextSegment[] {
    const segments: TextSegment[] = [];
    let currentText = '';
    let currentColor = '#FFFFFF';
    let isBold = false;

    // Replace <br> with \n for line breaks
    html = html.replace(/<br\s*\/?>/gi, '\n');

    // Simple HTML parser
    const regex = /<span(?:\s+style="([^"]*)")?>([^<]*)<\/span>/g;
    let match;
    let lastIndex = 0;

    while ((match = regex.exec(html)) !== null) {
        // Add any text before this span, but ignore literal <span> or </span>
        if (match.index > lastIndex) {
            const text = html.substring(lastIndex, match.index)
                .replace(/<span>|<\/span>/g, '') // Remove literal span tags
                .replace(/\n/g, '\n'); // Keep line breaks
            if (text.trim()) segments.push({ text, color: currentColor, bold: isBold });
        }

        const [, style, text] = match;
        // Ignore literal <span> or </span> as text
        if (text.trim() === '<span>' || text.trim() === '</span>') {
            lastIndex = regex.lastIndex;
            continue;
        }
        const segment: TextSegment = { text: text.replace(/<span>|<\/span>/g, '') };

        if (style) {
            if (style.includes('color:')) {
                const colorMatch = style.match(/color:\s*([^;]+)/);
                if (colorMatch) segment.color = colorMatch[1].trim();
            }
            if (style.includes('font-weight: bold')) {
                segment.bold = true;
            }
        }

        segments.push(segment);
        lastIndex = regex.lastIndex;
    }

    // Add any remaining text, again stripping literal span tags
    if (lastIndex < html.length) {
        const text = html.substring(lastIndex)
            .replace(/<span>|<\/span>/g, '')
            .replace(/\n/g, '\n');
        if (text.trim()) segments.push({ text, color: currentColor, bold: isBold });
    }

    return segments;
}

async function createMotdCanvas(motdHtml: string, serverType: ServerType): Promise<Buffer> {
    // Create canvas with enough height for the MOTD
    const canvas = createCanvas(600, 80); // Reduced height
    const ctx = canvas.getContext('2d');

    // Load background image based on server type
    const bgImage = await loadImage(path.join(process.cwd(), 'assets', 'images', serverType === ServerType.HOLYPVP ? 'holy-bg.png' : 'scala-bg.png'));
    
    // Draw semi-transparent background
    ctx.globalAlpha = 0.3;
    ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1.0;

    // Add a semi-transparent dark overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Parse MOTD HTML
    const segments = parseHtmlMotd(motdHtml);

    // Draw text segments
    let x = 20;
    let y = 30; // First line y position
    const maxWidth = 560;
    const lineHeight = 25; // Reduced line height
    let currentLine = '';
    let currentLineSegments: TextSegment[] = [];
    let isFirstLine = true;

    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 2;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;

    // First pass: collect segments for line wrapping
    for (const segment of segments) {
        const text = segment.text;
        if (text === '\n') {
            // Draw current line
            let drawX = x;
            for (const lineSeg of currentLineSegments) {
                ctx.font = lineSeg.bold 
                    ? (isFirstLine ? '18px "Roboto Bold"' : '16px "Roboto Bold"')
                    : (isFirstLine ? '18px "Roboto"' : '16px "Roboto"');
                ctx.fillStyle = lineSeg.color || '#FFFFFF';
                ctx.fillText(lineSeg.text, drawX, y);
                drawX += ctx.measureText(lineSeg.text).width;
            }
            
            // Reset for next line
            y += lineHeight;
            isFirstLine = false;
            currentLine = '';
            currentLineSegments = [];
            continue;
        }

        ctx.font = segment.bold 
            ? (isFirstLine ? '18px "Roboto Bold"' : '16px "Roboto Bold"')
            : (isFirstLine ? '18px "Roboto"' : '16px "Roboto"');
        
        const words = text.split(' ');
        for (const word of words) {
            const testLine = currentLine + (currentLine ? ' ' : '') + word;
            const metrics = ctx.measureText(testLine);
            
            if (metrics.width > maxWidth && currentLine !== '') {
                // Draw current line
                let drawX = x;
                for (const lineSeg of currentLineSegments) {
                    ctx.font = lineSeg.bold 
                        ? (isFirstLine ? '18px "Roboto Bold"' : '16px "Roboto Bold"')
                        : (isFirstLine ? '18px "Roboto"' : '16px "Roboto"');
                    ctx.fillStyle = lineSeg.color || '#FFFFFF';
                    ctx.fillText(lineSeg.text, drawX, y);
                    drawX += ctx.measureText(lineSeg.text).width;
                }
                
                // Reset for next line
                y += lineHeight;
                isFirstLine = false;
                currentLine = word;
                currentLineSegments = [{ ...segment, text: word }];
            } else {
                currentLine = testLine;
                if (currentLine === word) {
                    currentLineSegments = [{ ...segment, text: word }];
                } else {
                    const lastSeg = currentLineSegments[currentLineSegments.length - 1];
                    if (lastSeg && lastSeg.color === segment.color && lastSeg.bold === segment.bold) {
                        lastSeg.text += ' ' + word;
                    } else {
                        currentLineSegments.push({ ...segment, text: ' ' + word });
                    }
                }
            }
        }
    }

    // Draw remaining line
    if (currentLine) {
        let drawX = x;
        for (const lineSeg of currentLineSegments) {
            ctx.font = lineSeg.bold 
                ? (isFirstLine ? '18px "Roboto Bold"' : '16px "Roboto Bold"')
                : (isFirstLine ? '18px "Roboto"' : '16px "Roboto"');
            ctx.fillStyle = lineSeg.color || '#FFFFFF';
            ctx.fillText(lineSeg.text, drawX, y);
            drawX += ctx.measureText(lineSeg.text).width;
        }
    }

    return canvas.toBuffer();
}

export const data = new SlashCommandBuilder()
    .setName('ip')
    .setDescription('Get server IP information');

export async function execute(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply();

        // Get server config based on guild
        const serverType = serverUtils.getServerTypeFromGuildId(interaction.guildId || '');
        serverUtils.setServerType(serverType);
        const config = serverUtils.getConfig();

        // Get server status and MOTD
        const status = await pingServer(config.info.ip);
        console.log('[IP] Server status:', status);

        const logoUrl = config.info.logo || undefined;
        const embed = new EmbedBuilder()
            .setColor(config.theme.primary)
            .setAuthor({
                name: 'SERVER INFORMATION',
                iconURL: logoUrl
            });

        if (logoUrl) {
            embed.setThumbnail(logoUrl);
        }

        // Create MOTD image if server is online
        let motdAttachment: AttachmentBuilder | undefined;
        if (status.online && status.rawMotd) {
            const motdBuffer = await createMotdCanvas(status.rawMotd, serverType);
            motdAttachment = new AttachmentBuilder(motdBuffer, { name: 'motd.png' });
            embed.setImage('attachment://motd.png');
        }

        // Add server information
        embed.addFields(
            {
                name: '🌐 Java IP:',
                value: `\`${config.info.ip}\``,
                inline: true
            },
            {
                name: '📱 Bedrock IP:',
                value: `\`bedrock.${config.info.ip}\``,
                inline: true
            }
        );

        // Add version info if available
        if (status.online && status.version) {
            embed.addFields({
                name: '🎮 Version:',
                value: status.version,
                inline: false
            });
        }

        // Add any additional server info
        if (serverType === ServerType.HOLYPVP) {
            embed.addFields({
                name: '🎯 NextGen:',
                value: `[@holypvp.net/discord](${config.info.discord})`,
                inline: false
            });
        }

        embed.setFooter({ 
            text: 'Scala Studios',
            iconURL: logoUrl
        });

        // Send the embed with the MOTD attachment if available
        await interaction.editReply({ 
            embeds: [embed],
            files: motdAttachment ? [motdAttachment] : undefined
        });
    } catch (error) {
        console.error('[IP] Error executing ip command:', error);
        await interaction.editReply({ 
            content: '❌ Failed to get server information. Please try again later.'
        });
    }
} 