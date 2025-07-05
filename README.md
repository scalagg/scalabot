# ScalaBot

A Discord bot for our Minecraft network, providing cross-platform moderation, ticket systems, and comprehensive server management tools. This bot is for internal use only and is not open source.

## Features

### Core Features
- 🎮 Cross-platform punishment system (Minecraft ↔ Discord)
- 🎫 Advanced ticket system with appeals
- 📊 Server status monitoring
- 👮 Discord moderation tools
- 🎭 Role management system

### Additional Features
- 📱 Social media integration
- 👤 User information system
- 🏆 Practice/Duels tracking
- 🎁 Giveaway system
- 📈 Leaderboards
- 🛡️ Anticheat integration

## Installation

### Prerequisites
- Node.js 18+ or Bun 1.0+
- Redis server
- MongoDB database
- Discord Bot Token
- Minecraft Server access
- Internal network access

### Setup
1. Ensure you have internal network access and necessary permissions
2. Install dependencies:
```bash
bun install
```

3. Configure the bot:
Create a `config.toml` file with the following structure:
```toml
[discord]
token = "your_discord_token"

[redis]
url = "your_redis_url"

[mongodb]
uri = "your_mongodb_uri"

[server]
# Add other server-specific configurations
```

4. Run the bot:
```bash
bun run index.ts
```

## Development Roadmap

### Phase 1: Core Infrastructure (Completed)
- [x] Basic bot setup
- [x] Redis integration
- [x] Cross-platform punishment system
- [x] Ticket system implementation

### Phase 2: Server Management (Completed)
- [x] Server status monitoring
- [x] Player tracking
- [x] MOTD display
- [x] Performance metrics

### Phase 3: Moderation Tools (Completed)
- [x] Discord moderation commands
- [x] Role management
- [x] Auto-moderation
- [x] Logging system

### Phase 4: Additional Features (Planned)
- [x] Social commands
- [ ] User information system
- [ ] Practice/Duels system
- [x] Giveaway system
- [ ] Leaderboards
- [ ] Anticheat integration

## Progress Tracking

### High Priority
- [ ] Fix Redis NullPointerException
- [ ] Implement punishment system
- [ ] Develop ticket system

### Medium Priority
- [ ] Server status system
- [ ] Discord moderation
- [ ] Role management

### Low Priority
- [ ] Social commands
- [ ] User information
- [ ] Practice/Duels
- [ ] Giveaway system
- [ ] Leaderboards
- [ ] Anticheat integration

## Internal Development Guidelines

1. All development must be done on internal development branches
2. Code reviews are required before merging to main
3. Follow the established coding standards
4. Document all major changes
5. Test thoroughly before deployment

## Dependencies

- [Bun](https://bun.sh) - Fast all-in-one JavaScript runtime
- [Discord.js](https://discord.js.org) - Discord API wrapper
- [Redis](https://redis.io) - In-memory data structure store
- [MongoDB](https://www.mongodb.com) - NoSQL database
