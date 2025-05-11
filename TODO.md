# Discord Bot Todo List

## High Priority
- [ ] Fix Redis NullPointerException in DiscordSync
  - [ ] Investigate `WrappedRedisCodec.interpretPacketId()` returning null
  - [ ] Add null checks in `WrappedRedisPubSubListener.message()`
  - [ ] Ensure packet ID is properly set in all Redis messages
  - [ ] Add error handling for null packet IDs
- [ ] Implement Cross-Platform Punishment System
  - [ ] Sync game bans with Discord server access restrictions
  - [ ] Implement muted role/timeout system for in-game mutes
  - [ ] Create punishment tracking system
  - [ ] Add punishment ID generation and tracking
- [ ] Develop Ticket System
  - [ ] Create appeal system with punishment details integration
  - [ ] Implement multi-modal support forms
  - [ ] Add staff response handling
  - [ ] Create automatic unban functionality
  - [ ] Add ticket management commands

## Medium Priority
- [ ] Improve error handling in Redis message processing
- [ ] Add logging for Redis message failures
- [ ] Implement retry mechanism for failed Redis operations
- [ ] Create Server Status System
  - [ ] Display player count
  - [ ] Show proxy ping
  - [ ] Display MOTD with image
  - [ ] Add server status commands
- [ ] Implement Discord Moderation System
  - [ ] Add ban command
  - [ ] Add timeout command
  - [ ] Add kick command
  - [ ] Add temporary mute functionality
  - [ ] Implement purge command
  - [ ] Add automod features
- [ ] Develop Role Management
  - [ ] Create role selection menu
  - [ ] Implement ping role system
  - [ ] Add role management commands

## Low Priority
- [ ] Add unit tests for Redis message handling
- [ ] Document Redis message format requirements
- [ ] Create monitoring for Redis message processing
- [ ] Implement Social Commands
  - [ ] Add Instagram command
  - [ ] Add Twitter command
  - [ ] Add Teamspeak command
  - [ ] Add TikTok command
- [ ] Create User Information System
  - [ ] Add player skin command
  - [ ] Implement user info command (Discord + in-game)
  - [ ] Add IP lookup command
- [ ] Develop Practice/Duels System
  - [ ] Add match history commands
  - [ ] Implement match lookup by ID
- [ ] Create Giveaway System
  - [ ] Add giveaway creation
  - [ ] Implement winner selection
  - [ ] Add giveaway management commands
- [ ] Implement Leaderboard System
  - [ ] Create various leaderboard categories
  - [ ] Add leaderboard commands
- [ ] Add Anticheat Integration
  - [ ] Connect to MongoDB for logs
  - [ ] Create anticheat log display commands

## Notes
- The error occurs when processing messages on the 'discord' channel
- The issue appears to be related to packet ID interpretation
- Need to ensure all Redis messages include a valid packet ID
- Consider implementing a caching system for frequently accessed data
- Plan to add rate limiting for commands to prevent spam
