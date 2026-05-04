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

## 7. Workflow Commands

说明：本节为内部技术契约，UI / 产品名称为"命令宏"，接口命名保持 `workflow.*` 不变。

命名与字段约定：
- Command 名称使用 dot notation（如 `workflow.recipe.create`）。
- JSON 字段使用 camelCase。
- Recipe 显示名使用 `title`（不使用 `name`）。
- Run / Step 状态字段使用 `state`（不使用 `status`），枚举值见状态约定。
- 状态约定：Run — `running | completed | failed`；Step — `pending | running | completed | failed`。future 增量：`canceled | interrupted | skipped | queued`。

### 7.1 `workflow.recipe.create`
Request:
```json
{
  "title": "部署 nginx",
  "description": "拉代码并重启服务",
  "groupId": null,
  "paramsJson": "[{\"key\":\"release_dir\",\"label\":\"发布目录\",\"required\":true,\"defaultValue\":null}]",
  "stepsJson": "[{\"id\":\"step-1\",\"title\":\"拉取代码\",\"command\":\"cd {{release_dir}} && git pull\"}]"
}
```
Response:
```json
{
  "id": "workflow-recipe-uuid"
}
```

### 7.2 `workflow.recipe.update`
Request:
```json
{
  "id": "workflow-recipe-uuid",
  "title": "部署 nginx",
  "description": "更新代码并重启服务",
  "groupId": null,
  "paramsJson": "[]",
  "stepsJson": "[]"
}
```
Response:
```json
{
  "success": true
}
```

### 7.3 `workflow.recipe.list`
Response:
```json
[
  {
    "id": "workflow-recipe-uuid",
    "title": "部署 nginx",
    "description": "拉代码并重启服务",
    "groupId": null,
    "stepCount": 2,
    "updatedAt": "2026-04-11T10:00:00Z"
  }
]
```

### 7.4 `workflow.recipe.get`
Response:
```json
{
  "id": "workflow-recipe-uuid",
  "title": "部署 nginx",
  "description": "拉代码并重启服务",
  "groupId": null,
  "params": [
    {
      "id": "param-uuid",
      "key": "release_dir",
      "label": "发布目录",
      "type": "text",
      "required": true,
      "defaultValue": null,
      "sortOrder": 0
    }
  ],
  "steps": [
    {
      "id": "step-uuid",
      "title": "拉取代码",
      "stepType": "command",
      "commandTemplate": "git pull",
      "cwdTemplate": "{{release_dir}}",
      "timeoutSecs": 60,
      "continueOnError": false,
      "sortOrder": 0
    }
  ],
  "createdAt": "2026-04-11T10:00:00Z",
  "updatedAt": "2026-04-11T10:00:00Z"
}
```

### 7.5 `workflow.run.start`
Request:
```json
{
  "recipeId": "workflow-recipe-uuid",
  "hostId": "host-uuid",
  "params": {
    "release_dir": "/srv/app",
    "service": "nginx"
  }
}
```
Response:
```json
{
  "id": "workflow-run-uuid"
}
```

说明：`hostId` 为必填字段，在 Run 启动时指定目标主机。Recipe 本身不绑定主机。

### 7.6 `workflow.run.get`
Response:
```json
{
  "id": "workflow-run-uuid",
  "recipeId": "workflow-recipe-uuid",
  "recipeTitle": "部署 nginx",
  "hostId": "host-uuid",
  "state": "completed",
  "params": {
    "release_dir": "/srv/app",
    "service": "nginx"
  },
  "startedAt": "2026-04-11T10:00:00Z",
  "finishedAt": "2026-04-11T10:00:04Z",
  "steps": [
    {
      "stepId": "step-1",
      "title": "拉取代码",
      "commandTemplate": "cd {{release_dir}} && git pull",
      "resolvedCommand": "cd /srv/app && git pull",
      "state": "completed",
      "stdout": "Already up to date.\n",
      "stderr": "",
      "exitCode": 0,
      "durationMs": 820,
      "startedAt": "2026-04-11T10:00:00Z",
      "finishedAt": "2026-04-11T10:00:01Z"
    }
  ],
  "error": null
}
```

### 7.7 `workflow.run.list`
Request:
```json
{
  "recipeId": "workflow-recipe-uuid",
  "limit": 10
}
```
Response:
```json
[
  {
    "id": "workflow-run-uuid",
    "recipeId": "workflow-recipe-uuid",
    "recipeTitle": "部署 nginx",
    "hostId": "host-uuid",
    "state": "failed",
    "startedAt": "2026-04-11T10:00:00Z",
    "finishedAt": "2026-04-11T10:00:04Z",
    "error": "Step '重启服务' failed"
  }
]
```
Response:
```json
{
  "id": "workflow-recipe-uuid"
}
```

### 7.2 `workflow_run_start`
Request:
```json
{
  "recipeId": "workflow-recipe-uuid",
  "params": {
    "release_dir": "/srv/app",
    "service": "nginx"
  }
}
```
Response:
```json
{
  "id": "workflow-run-uuid"
}
```

### 7.3 `workflow_run_get`
Response:
```json
{
  "id": "workflow-run-uuid",
  "recipeId": "workflow-recipe-uuid",
  "recipeTitle": "部署 nginx",
  "hostId": "host-uuid",
  "state": "completed",
  "startedAt": "2026-04-11T10:00:00Z",
  "finishedAt": "2026-04-11T10:00:04Z",
  "params": {
    "release_dir": "/srv/app",
    "service": "nginx"
  },
  "steps": [
    {
      "stepId": "step-1",
      "title": "拉取代码",
      "command": "cd {{release_dir}} && git pull",
      "renderedCommand": "cd /srv/app && git pull",
      "state": "completed",
      "stdout": "Already up to date.\n",
      "stderr": "",
      "exitCode": 0,
      "startedAt": "2026-04-11T10:00:00Z",
      "finishedAt": "2026-04-11T10:00:01Z"
    }
  ],
  "error": null
}
```

### 7.4 `workflow_run_list`
Request:
```json
{
  "recipeId": "workflow-recipe-uuid",
  "limit": 10
}
```
Response:
```json
[
  {
    "id": "workflow-run-uuid",
    "recipeId": "workflow-recipe-uuid",
    "recipeTitle": "部署 nginx",
    "hostId": "host-uuid",
    "state": "failed",
    "startedAt": "2026-04-11T10:00:00Z",
    "finishedAt": "2026-04-11T10:00:04Z",
    "params": {
      "release_dir": "/srv/app"
    },
    "steps": [],
    "error": "Step '重启服务' failed"
  }
]
```

## 8. Event Contracts

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

### 8.6 `workflow:run_updated`
```json
{
  "run": {
    "id": "workflow-run-uuid",
    "recipeId": "workflow-recipe-uuid",
    "recipeTitle": "部署 nginx",
    "hostId": "host-uuid",
    "state": "running",
    "startedAt": "2026-04-11T10:00:00Z",
    "finishedAt": null,
    "params": {
      "release_dir": "/srv/app"
    },
    "steps": [],
    "error": null
  }
}
```
