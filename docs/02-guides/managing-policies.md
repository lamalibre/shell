# Managing Policies

> Policies control who can access which agents, what commands are blocked, and how long idle sessions persist.

## In Plain English

A policy is a bundle of access rules that gets applied to an agent when you enable shell access. Think of it as a visitor badge — the badge determines which rooms the visitor can enter, what time the badge expires, and what they are not allowed to touch.

Every shell installation comes with a default policy. You can create additional policies for different scenarios — a restrictive policy for production machines, a permissive one for development boxes.

## Default Policy

The default policy is created automatically and includes:

**18 hard-blocked commands (prefix/exact match):**
```
rm -rf /     rm -rf /*    rm -rf ~      rm -rf ~/*
mkfs         dd if=       :(){ :|:& };:
shutdown     reboot       halt          poweroff
chmod -R 777 /            > /dev/sda    > /dev/disk
curl|sh      curl|bash    wget|sh       wget|bash
```

**9 restricted prefixes (all blocked by default, individually enableable per policy via `true`):**
```
sudo    su    launchctl    systemctl    networksetup
ifconfig    diskutil    iptables    ufw
```

**Other defaults:**
- Max file size: 100 MB (for future file transfer feature)
- Inactivity timeout: 600 seconds (10 minutes)
- IP allowlist: empty (all IPs allowed)
- IP denylist: empty

## Creating a Policy

### Via CLI

Policies are managed through the REST API. Using curl:

```bash
API_KEY=$(cat ~/.shell/api-key)

curl -sk -X POST https://localhost:9494/api/shell/policies \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production",
    "description": "Restricted access for production machines",
    "allowedIps": ["192.168.1.0/24", "10.0.0.0/8"],
    "deniedIps": ["192.168.1.99/32"],
    "commandBlocklist": {
      "hardBlocked": ["rm -rf /", "shutdown -h now"],
      "restricted": {
        "sudo": true,
        "systemctl": true,
        "iptables": true
      }
    }
  }'
```

### Via Desktop App

1. Open the **Policies** tab
2. Click **Create Policy**
3. Fill in name, description, IP ranges, and blocklist settings
4. Click **Save**

## Policy Fields

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | string | Yes | — | Display name (1-100 chars) |
| `id` | string | No | Auto-slugified from name | Identifier (`[a-z0-9-]+`, 1-50 chars) |
| `description` | string | No | `""` | Description (max 500 chars) |
| `allowedIps` | string[] | No | `[]` | IPv4/CIDR allowlist (empty = all allowed) |
| `deniedIps` | string[] | No | `[]` | IPv4/CIDR denylist (deny takes precedence) |
| `maxFileSize` | number | No | `104857600` | Max file size in bytes (for future use) |
| `inactivityTimeout` | number | No | `600` | Seconds before idle session disconnect |
| `commandBlocklist` | object | No | Default blocklist | Hard-blocked commands + restricted prefixes |

## IP Access Control

Policies define allowed and denied IP ranges using IPv4 CIDR notation:

```json
{
  "allowedIps": ["192.168.1.0/24", "10.0.0.0/8"],
  "deniedIps": ["192.168.1.99/32"]
}
```

**Rules:**
- Deny takes precedence — if an IP matches both lists, it is denied
- Empty allowlist = all IPs allowed (unless in denylist)
- Non-empty allowlist = only those IPs can connect
- Single IPs use `/32` suffix or bare IP format

## Command Blocklist

The blocklist has two tiers:

**Hard-blocked** — exact string match. If the user types exactly this string, it is blocked:
```json
{ "hardBlocked": ["rm -rf /", "mkfs", "shutdown -h now"] }
```

**Restricted prefixes** — commands starting with these strings. Each prefix is a toggle (true = enabled):
```json
{
  "restricted": {
    "sudo": true,
    "su": false,
    "systemctl": true
  }
}
```

The blocklist is advisory — it prevents accidental execution but can be bypassed. See [Security Model](../01-concepts/security-model.md) for details.

## Applying Policies to Agents

When you enable shell access for an agent, you specify which policy to use:

```bash
shell enable office-ubuntu
# Prompts for duration and policy selection
```

Or via API:

```bash
curl -sk -X POST https://localhost:9494/api/shell/enable/office-ubuntu \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"durationMinutes": 30, "policyId": "production"}'
```

If no policy is specified, the default policy is used.

## Updating and Deleting Policies

**Update:**
```bash
curl -sk -X PATCH https://localhost:9494/api/shell/policies/production \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"allowedIps": ["10.0.0.0/8"]}'
```

Updates are deep-merged for the command blocklist — you can add new entries without replacing existing ones.

**Delete:**
```bash
curl -sk -X DELETE https://localhost:9494/api/shell/policies/production \
  -H "Authorization: Bearer $API_KEY"
```

Deletion is prevented if:
- The policy is the default policy
- An active agent is using the policy

## Related Documentation

- [Security Model](../01-concepts/security-model.md) — how policies fit into the auth chain
- [Config & Policies API](../04-api-reference/config-policies.md) — full API reference
- [Config Files](../05-reference/config-files.md) — where policies are stored on disk
