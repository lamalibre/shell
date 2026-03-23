# Config & Policies API

> Endpoints for managing the global shell configuration and access policies.

## Configuration

### `GET /api/shell/config`

Read the global shell configuration.

**Auth:** Admin only

**Response (200):**
```json
{
  "enabled": true,
  "defaultPolicy": "default",
  "policies": [
    {
      "id": "default",
      "name": "Default",
      "description": "Standard shell access with restricted commands",
      "allowedIps": [],
      "deniedIps": [],
      "maxFileSize": 104857600,
      "inactivityTimeout": 600,
      "commandBlocklist": {
        "hardBlocked": ["rm -rf /", "..."],
        "restricted": { "sudo": false, "su": false, "..." : false }
      }
    }
  ]
}
```

### `PATCH /api/shell/config`

Update the global enabled state or default policy.

**Auth:** Admin only

**Request body:**
```json
{
  "enabled": true,
  "defaultPolicy": "production"
}
```

Both fields are optional. If `defaultPolicy` is provided, it must reference an existing policy ID.

**Response (200):**
```json
{
  "ok": true,
  "config": {
    "enabled": true,
    "defaultPolicy": "production",
    "policies": ["..."]
  }
}
```

**Errors:**
- `400` — validation failed, or defaultPolicy references non-existent policy

## Policies

### `GET /api/shell/policies`

List all policies with the default policy ID.

**Auth:** Admin only

**Response (200):**
```json
{
  "defaultPolicy": "default",
  "policies": [
    {
      "id": "default",
      "name": "Default",
      "description": "Standard shell access with restricted commands",
      "allowedIps": [],
      "deniedIps": [],
      "maxFileSize": 104857600,
      "inactivityTimeout": 600,
      "commandBlocklist": { "..." }
    }
  ]
}
```

### `POST /api/shell/policies`

Create a new policy.

**Auth:** Admin only

**Request body:**
```json
{
  "name": "Production",
  "description": "Restricted access for production machines",
  "allowedIps": ["192.168.1.0/24"],
  "deniedIps": [],
  "inactivityTimeout": 300,
  "commandBlocklist": {
    "hardBlocked": ["rm -rf /", "shutdown -h now"],
    "restricted": {
      "sudo": true,
      "systemctl": true
    }
  }
}
```

| Field | Required | Default |
| --- | --- | --- |
| `name` | Yes | — |
| `id` | No | Auto-slugified from name |
| `description` | No | `""` |
| `allowedIps` | No | `[]` |
| `deniedIps` | No | `[]` |
| `maxFileSize` | No | `104857600` (100 MB), range: 1024–524288000 |
| `inactivityTimeout` | No | `600` (10 min), range: 60–7200 |
| `commandBlocklist` | No | Empty (`{ hardBlocked: [], restricted: {} }`) |

**Response (200):**
```json
{
  "ok": true,
  "policy": {
    "id": "production",
    "name": "Production",
    "..."
  }
}
```

**Errors:**
- `400` — validation failed (bad CIDR, name too long, etc.)
- `409` — policy ID already exists

### `PATCH /api/shell/policies/:policyId`

Update an existing policy.

**Auth:** Admin only

All fields are optional. The command blocklist is deep-merged — you can add entries without replacing existing ones.

**Request body:**
```json
{
  "allowedIps": ["10.0.0.0/8"],
  "commandBlocklist": {
    "restricted": { "sudo": true }
  }
}
```

**Response (200):**
```json
{
  "ok": true,
  "policy": { "..." }
}
```

**Errors:**
- `400` — validation failed
- `404` — policy not found

### `DELETE /api/shell/policies/:policyId`

Delete a policy.

**Auth:** Admin only

**Response (200):**
```json
{ "ok": true }
```

**Errors:**
- `400` — cannot delete the default policy, or policy is assigned to an active agent
- `404` — policy not found

## Related Documentation

- [Agents & Sessions API](agents-sessions.md) — enabling agents with policies
- [Managing Policies](../02-guides/managing-policies.md) — guide
- [API Overview](overview.md) — authentication and error format
