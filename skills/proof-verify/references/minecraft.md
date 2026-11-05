### Minecraft (Paper/Spigot) plugins — test on a REAL server with a bot player
Build with Maven (`mvn -q package`, Maven is installed; Gradle is not — don't use it unless a wrapper
`gradlew` exists). Target Paper **1.21.11** (`paper-api 1.21.11-R0.1-SNAPSHOT`, repo
`https://repo.papermc.io/repository/maven-public/`, Java 21). Then run the server test — it starts a real
Paper server, installs your jar, joins a fake player "TestBot" (operator) and runs your scenario:

```bash
node <skill>/scripts/mc_test.mjs --jar target/MyPlugin-1.0.jar --steps .proof/mc-steps.json --out .proof/mc
```
Takes ~40 s. Checks "plugin enabled", every step, and fails on ERROR/exceptions in the server log.
The Paper server jar and the bot library are already installed — don't download them and don't run
the Paper jar yourself (it unpacks hundreds of MB into your project); `mc_test.mjs` does everything.
Steps (see header of `mc_test.mjs` for all keys):
```json
[
 {"name":"command replies","chat":"/kit starter","expectChat":"(получил|received).*starter"},
 {"name":"items given","expectInventory":"iron_sword","count":1},
 {"name":"cooldown works","chat":"/kit starter","expectChat":"(подожди|cooldown)"},
 {"name":"admin via console","console":"kit reload","expectLog":"reloaded"},
 {"name":"data survives rejoin","rejoin":true,"expectInventory":"iron_sword"},
 {"name":"data survives restart","restart":true,"chat":"/kit starter","expectChat":"(подожди|cooldown)"},
 {"name":"bot state","expect":"bot.health > 0"}
]
```
Test every command, permission/edge cases (wrong args → usage message), config reload, persistence.
Also unit-test pure logic (JUnit) where it helps. Read `.proof/mc/chat.log` and `server.log` yourself.
