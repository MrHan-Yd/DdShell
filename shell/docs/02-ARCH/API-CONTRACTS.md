# API Contracts

本文件定义前后端 command/event 的字段级契约与示例。

## 1. 通用响应结构
```json
{
  "success": true,
  "data": {},
  "error": null,
  "requestId": "uuid"
}
```

错误示例：
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "AUTH_FAILED",
    "message": "Authentication failed",
    "details": {}
  },
  "requestId": "uuid"
}
```

## 2. Connection Commands

### 2.1 `connection.create`
Request:
```json
{
  "name": "prod-01",
  "host": "10.0.0.10",
  "port": 22,
  "username": "root",
  "authType": "password",
  "groupId": "grp-1"
}
```
Response:
```json
{
  "id": "host-uuid"
}
```

### 2.2 `connection.update`
Request:
```json
{
  "id": "host-uuid",
  "name": "prod-01-new"
}
```

### 2.3 `connection.delete`
Request:
```json
{
  "id": "host-uuid"
}
```

## 3. Session Commands

### 3.1 `session.connect`
Request:
```json
{
  "hostId": "host-uuid",
  "termOptions": {
    "cols": 120,
    "rows": 40,
    "encoding": "utf-8"
  }
}
```
Response:
```json
{
  "sessionId": "sess-uuid"
}
```

### 3.2 `session.disconnect`
Request:
```json
{
  "sessionId": "sess-uuid"
}
```

## 4. SFTP / Transfer Commands

### 4.1 `sftp.list_dir`
Request:
```json
{
  "sessionId": "sess-uuid",
  "remotePath": "/var/log"
}
```
Response:
```json
{
  "entries": [
    {"name": "syslog", "type": "file", "size": 1024, "mtime": 1710000000}
  ]
}
```

### 4.2 `sftp.transfer.start`
Request:
```json
{
  "sessionId": "sess-uuid",
  "direction": "upload",
  "localPath": "C:/logs/app.log",
  "remotePath": "/tmp/app.log"
}
```
Response:
```json
{
  "taskId": "task-uuid"
}
```

### 4.3 `file.upload.dragdrop`
Request:
```json
{
  "sessionId": "sess-uuid",
  "localPaths": ["C:/a.txt", "C:/b.txt"],
  "remotePath": "/home/user"
}
```
Response:
```json
{
  "taskIds": ["task-1", "task-2"]
}
```

### 4.4 `transfer.archive.start`
Request:
```json
{
  "sessionId": "sess-uuid",
  "direction": "upload",
  "paths": ["/local/dir"],
  "targetPath": "/remote/dir",
  "archiveFormat": "tar.gz"
}
```

## 5. Metrics / System Commands

### 5.1 `metrics.start`
Request:
```json
{
  "sessionId": "sess-uuid",
  "intervalSec": 2,
  "windowMinutes": 15
}
```
Response:
```json
{
  "collectorId": "collector-uuid"
}
```

### 5.2 `metrics.snapshot`
Response:
```json
{
  "uptime": {"seconds": 86400},
  "load": {"l1": 0.21, "l5": 0.42, "l15": 0.35},
  "cpu": {"usagePercent": 23.1},
  "memory": {"totalBytes": 17179869184, "usedBytes": 8589934592, "freeBytes": 4294967296, "cacheBytes": 4294967296, "usagePercent": 50.0},
  "network": {"rxBytesPerSec": 12000, "txBytesPerSec": 3000},
  "processes": [{"pid": 1234, "name": "nginx", "cpuPercent": 2.1, "memPercent": 1.3, "command": "nginx: worker"}]
}
```

### 5.3 `disk.snapshot`
Response:
```json
{
  "filesystems": [
    {"filesystem": "/dev/sda1", "mount": "/", "totalBytes": 1000000000, "usedBytes": 600000000, "availableBytes": 400000000, "usagePercent": 60.0}
  ]
}
```

### 5.4 `network.interfaces.list`
Response:
```json
{
  "interfaces": ["eth0", "eth1"]
}
```

### 5.5 `network.connections.snapshot`
Response:
```json
{
  "listeners": [{"proto": "tcp", "addr": "0.0.0.0:22", "process": "sshd"}],
  "connections": [{"proto": "tcp", "local": "10.0.0.10:22", "remote": "10.0.0.2:50124", "state": "ESTABLISHED"}]
}
```

## 6. Command Assist Commands

### 6.1 `system.detect`
Response:
```json
{
  "os": "linux",
  "distro": "ubuntu",
  "distroVersion": "22.04",
  "shell": "bash"
}
```

### 6.2 `command.suggest`
Request:
```json
{
  "sessionId": "sess-uuid",
  "input": "docker rm",
  "cursorPos": 9,
  "context": "terminal"
}
```
Response:
```json
{
  "items": [
    {"text": "docker rmi", "kind": "command", "source": "system", "distroTags": ["common"], "score": 0.98}
  ],
  "sourceMeta": {"history": true, "system": true, "rules": true}
}
```

### 6.3 `command_history.list`
Response:
```json
{
  "items": [
    {"id": "hist-1", "command": "docker images", "timestamp": 1710001111, "hostId": "host-uuid", "sessionId": "sess-uuid"}
  ],
  "nextCursor": null
}
```

### 6.4 `command.quick_path.list`
Response:
```json
{
  "items": ["/var/log", "/home/user", "/etc/nginx"]
}
```

### 6.5 `command.quick_name.search`
Response:
```json
{
  "items": ["docker", "docker-compose", "dockerd"]
}
```

## 7. Event Contracts

### 7.1 `session:state_changed`
```json
{"sessionId":"sess-uuid","state":"connected"}
```

### 7.2 `session:output`
```json
{"sessionId":"sess-uuid","chunk":"ls -la\n"}
```

### 7.3 `transfer:progress`
```json
{"taskId":"task-uuid","progress":66.3,"speedBytesPerSec":102400}
```

### 7.4 `metrics:updated`
```json
{"sessionId":"sess-uuid","timestamp":"2026-03-05T12:00:00Z","cpu":{"usagePercent":35.2}}
```

### 7.5 `command_history:updated`
```json
{"hostId":"host-uuid","count":1024}
```

