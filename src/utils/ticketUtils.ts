import { TextChannel, ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { ObjectId } from 'mongodb';
import { ticketService } from '../services/TicketService';

export async function generateTranscript(channel: TextChannel): Promise<string> {
    const messages = await channel.messages.fetch({ limit: 100 });
    let transcript = `Ticket Transcript - ${channel.name}\n`;
    transcript += `Created at: ${channel.createdAt}\n\n`;

    messages.reverse().forEach(msg => {
        transcript += `[${msg.createdAt.toISOString()}] ${msg.author.tag}: ${msg.content}\n`;
        msg.embeds.forEach(embed => {
            transcript += `[Embed: ${embed.title || 'Untitled'}]\n`;
        });
        msg.attachments.forEach(attachment => {
            transcript += `[Attachment: ${attachment.url}]\n`;
        });
    });

    return transcript;
}

export async function closeTicket(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    ticketId: ObjectId,
    wasRated: boolean
) {
    if (!interaction.channel) return;

    // Generate transcript
    const transcript = await generateTranscript(interaction.channel as TextChannel);

    // Close the ticket in the database
    await ticketService.closeTicket(ticketId, interaction.user.id, transcript);

    // Send closure message
    const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('Ticket Closed')
        .setDescription(`Ticket closed by ${interaction.user}`)
        .setTimestamp();

    await interaction.channel.send({ embeds: [embed] });

    // Delete the channel after a delay
    setTimeout(async () => {
        await interaction.channel!.delete();
    }, 5000);

    if (interaction.message?.editable) {
        await interaction.update({
            content: 'Ticket will be closed in 5 seconds.',
            components: []
        });
    }
} 