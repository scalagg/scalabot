import { TextChannel, Message, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { config } from '../config/config';

export class TranscriptService {
    private static instance: TranscriptService;

    private constructor() {}

    public static getInstance(): TranscriptService {
        if (!TranscriptService.instance) {
            TranscriptService.instance = new TranscriptService();
        }
        return TranscriptService.instance;
    }

    public async createTranscript(channel: TextChannel): Promise<{ buffer: Buffer, messageCount: number }> {
        let allMessages: Message[] = [];
        let lastId: string | undefined;
        
        // Fetch all messages in batches
        while (true) {
            const options = { limit: 100 } as { limit: number; before?: string };
            if (lastId) options.before = lastId;
            
            const messages = await channel.messages.fetch(options);
            if (messages.size === 0) break;
            
            allMessages = [...allMessages, ...Array.from(messages.values())];
            lastId = messages.last()?.id;
        }

        // Sort messages by timestamp (oldest first)
        allMessages = allMessages.reverse();

        // Create HTML content
        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Ticket Transcript - ${channel.name}</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.5; margin: 0; padding: 20px; color: #2f3136; }
        .message { padding: 10px; margin: 5px 0; border-bottom: 1px solid #eee; }
        .message:hover { background-color: #f9f9f9; }
        .author { font-weight: bold; color: #5865f2; }
        .timestamp { color: #99aab5; font-size: 0.8em; margin-left: 10px; }
        .content { margin-top: 5px; }
        .attachment { color: #7289da; text-decoration: none; }
        .attachment:hover { text-decoration: underline; }
        .embed { margin: 5px 0; padding: 10px; background: #f6f6f7; border-left: 4px solid #5865f2; }
    </style>
</head>
<body>
    <h1>Ticket Transcript - #${channel.name}</h1>
    <div class="info">
        <p>Channel: #${channel.name}</p>
        <p>Created: ${channel.createdAt.toUTCString()}</p>
        <p>Total Messages: ${allMessages.length}</p>
    </div>
    <div class="messages">`;

        // Add each message to the transcript
        for (const message of allMessages) {
            const timestamp = message.createdAt.toUTCString();
            
            html += `
        <div class="message">
            <div>
                <span class="author">${message.author.tag}</span>
                <span class="timestamp">${timestamp}</span>
            </div>
            <div class="content">
                ${message.content || ''}
            </div>`;

            // Add attachments
            if (message.attachments.size > 0) {
                html += '<div class="attachments">';
                message.attachments.forEach(attachment => {
                    html += `<a href="${attachment.url}" class="attachment" target="_blank">${attachment.name}</a><br>`;
                });
                html += '</div>';
            }

            // Add embeds
            if (message.embeds.length > 0) {
                message.embeds.forEach(embed => {
                    html += `
                <div class="embed">
                    ${embed.title ? `<strong>${embed.title}</strong><br>` : ''}
                    ${embed.description || ''}
                </div>`;
                });
            }

            html += `
        </div>`;
        }

        html += `
    </div>
</body>
</html>`;

        return {
            buffer: Buffer.from(html, 'utf-8'),
            messageCount: allMessages.length
        };
    }

    public async saveTranscript(channel: TextChannel, closedBy: string, reason?: string): Promise<void> {
        try {
            const { buffer, messageCount } = await this.createTranscript(channel);
            
            // Create transcript file
            const attachment = new AttachmentBuilder(buffer, {
                name: `transcript-${channel.name}-${Date.now()}.html`,
                description: `Ticket transcript for #${channel.name}`
            });

            // Create embed for logs
            const embed = new EmbedBuilder()
                .setTitle('Ticket Transcript')
                .setColor('#2f3136')
                .setDescription(`Ticket channel \`#${channel.name}\` has been closed`)
                .addFields([
                    { name: '📝 Messages', value: messageCount.toString(), inline: true },
                    { name: '🔒 Closed By', value: `<@${closedBy}>`, inline: true },
                    { name: '⏰ Closed At', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                ]);

            if (reason) {
                embed.addFields({ name: '💭 Reason', value: reason, inline: false });
            }

            // Get logs channel
            const logsChannel = channel.guild.channels.cache.get(config.ticketLogsChannelId) as TextChannel;
            if (!logsChannel) {
                throw new Error('Logs channel not found');
            }

            // Send transcript
            await logsChannel.send({
                embeds: [embed],
                files: [attachment]
            });

        } catch (error) {
            console.error('[TranscriptService] Error saving transcript:', error);
            throw error;
        }
    }
}

export const transcriptService = TranscriptService.getInstance(); 