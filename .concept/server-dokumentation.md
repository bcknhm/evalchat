# Technische Dokumentation VPS bstlr.eu

## Server-Uebersicht

| Eigenschaft | Wert |
|-------------|------|
| Provider | Strato |
| Hostname | ubuntu |
| OS | Ubuntu 22.04 LTS / 24.04 LTS |
| IPv4 | 87.106.83.40 |
| IPv6 | 2a01:239:45a:7a00::1 |
| Domain | bstlr.eu |

---

## Benutzer

| User | Zweck | Shell | Sudo |
|------|-------|-------|------|
| root | Deaktiviert fuer SSH | /bin/bash | - |
| srvworker | Admin-User | /bin/bash | ja |

---

## Netzwerk

### DNS-Eintraege

| Typ | Name | Wert | TTL |
|-----|------|------|-----|
| A | @ | 87.106.83.40 | 3600 |
| A | * | 87.106.83.40 | 3600 |
| AAAA | @ | 2a01:239:45a:7a00::1 | 3600 |
| AAAA | * | 2a01:239:45a:7a00::1 | 3600 |

### Firewall (ufw)

| Port | Protokoll | Dienst |
|------|-----------|--------|
| 22 | TCP | SSH |
| 80 | TCP | HTTP |
| 443 | TCP | HTTPS |

Status: **aktiv**

```bash
# Status pruefen
sudo ufw status

# Regel hinzufuegen
sudo ufw allow <PORT>/tcp

# Regel entfernen
sudo ufw delete allow <PORT>/tcp
```

---

## SSH-Konfiguration

### Haertung

Datei: `/etc/ssh/sshd_config.d/hardening.conf`

```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 3
```

### Autorisierte Keys

Datei: `/home/srvworker/.ssh/authorized_keys`

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIgUSPwlW01tZbbCgLV25yNEjiSpBVMruG69zUN3zkO+
```

### Verbindung (vom Client)

```bash
ssh vps
# oder
ssh srvworker@87.106.83.40
```

---

## Fail2ban

Status: **aktiv**

Konfiguration: `/etc/fail2ban/jail.local`

```
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
```

```bash
# Status pruefen
sudo fail2ban-client status sshd

# Gebannte IPs anzeigen
sudo fail2ban-client status sshd | grep "Banned IP"

# IP manuell entbannen
sudo fail2ban-client set sshd unbanip <IP>
```

---

## Docker

### Installation

- Docker CE (Community Edition)
- Docker Compose Plugin v2

```bash
# Version pruefen
docker --version
docker compose version

# Laufende Container
docker ps

# Alle Container (inkl. gestoppte)
docker ps -a

# Logs eines Containers
docker logs <container-name>

# Container neu starten
docker compose restart
```

### Docker-Netzwerke

| Netzwerk | Zweck |
|----------|-------|
| proxy | Verbindung zwischen NPM und Apps |

```bash
# Netzwerke anzeigen
docker network ls
```

---

## Verzeichnisstruktur

```
/home/srvworker/
├── docker/
│   ├── nginx-proxy-manager/
│   │   ├── docker-compose.yml
│   │   ├── data/
│   │   └── letsencrypt/
│   ├── <app1>/
│   │   └── docker-compose.yml
│   └── <app2>/
│       └── docker-compose.yml
└── backups/
```

---

## Container

### nginx-proxy-manager

| Eigenschaft | Wert |
|-------------|------|
| Image | jc21/nginx-proxy-manager:latest |
| Container-Name | nginx-proxy-manager |
| Status | running |
| Restart-Policy | unless-stopped |

**Ports:**

| Host | Container | Bindung |
|------|-----------|---------|
| 80 | 80 | 0.0.0.0 |
| 443 | 443 | 0.0.0.0 |
| 81 | 81 | 127.0.0.1 (nur lokal) |

**Volumes:**

| Host | Container |
|------|-----------|
| ./data | /data |
| ./letsencrypt | /etc/letsencrypt |

**Compose-Datei:** `/home/srvworker/docker/nginx-proxy-manager/docker-compose.yml`

```yaml
services:
  npm:
    image: jc21/nginx-proxy-manager:latest
    container_name: nginx-proxy-manager
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "127.0.0.1:81:81"
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
    networks:
      - proxy

networks:
  proxy:
    name: proxy
    external: false
```

**Verwaltung:**

```bash
cd ~/docker/nginx-proxy-manager

# Starten
docker compose up -d

# Stoppen
docker compose down

# Logs
docker logs nginx-proxy-manager

# Update
docker compose pull
docker compose up -d
```

---

## Proxy Hosts (NPM)

| Subdomain | Ziel | SSL | Notizen |
|-----------|------|-----|---------|
| npm.bstlr.eu | 127.0.0.1:81 | Let's Encrypt | Admin-Panel |

---

## SSL-Zertifikate

Verwaltet durch Nginx Proxy Manager mit Let's Encrypt.

| Domain | Aussteller | Auto-Renewal |
|--------|------------|--------------|
| npm.bstlr.eu | Let's Encrypt | ja |

---

## Wartung

### System-Updates

```bash
sudo apt update
sudo apt upgrade -y
```

### Docker-Container aktualisieren

```bash
cd ~/docker/<app>
docker compose pull
docker compose up -d

# Alte Images aufraeumen
docker image prune -f
```

### Logs pruefen

```bash
# System-Log
sudo journalctl -xe

# SSH-Log
sudo tail -f /var/log/auth.log

# Docker-Container-Log
docker logs <container-name> --tail 100
```

### Backups

(Noch einzurichten)

```bash
# Beispiel: Docker-Volumes sichern
tar -czvf backup-npm-$(date +%Y%m%d).tar.gz ~/docker/nginx-proxy-manager/data
```

---

## Neue App hinzufuegen

1. Verzeichnis erstellen:
   ```bash
   mkdir -p ~/docker/<app-name>
   cd ~/docker/<app-name>
   ```

2. docker-compose.yml erstellen (Beispiel):
   ```yaml
   services:
     app:
       image: <image>
       container_name: <app-name>
       restart: unless-stopped
       networks:
         - proxy
       # ports nur wenn noetig (NPM macht Reverse Proxy)

   networks:
     proxy:
       external: true
   ```

3. Starten:
   ```bash
   docker compose up -d
   ```

4. In NPM Proxy Host einrichten:
   - Domain: `<app>.bstlr.eu`
   - Scheme: http
   - Forward Hostname: `<container-name>`
   - Forward Port: `<app-port>`
   - SSL: Request new certificate

---

## Changelog

| Datum | Aenderung |
|-------|-----------|
| 2026-03-29 | Initiales Setup: Ubuntu, SSH, UFW, Docker, NPM, Fail2ban |

---

*Dokumentversion: 1.0*
