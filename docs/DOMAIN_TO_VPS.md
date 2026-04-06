# Domain to VPS Guide

This guide explains exactly how to point a domain or subdomain to your VPS, verify DNS propagation, and confirm web traffic reaches your server.

## 1. What you need first

- A VPS with a public IPv4 address
- Access to your domain provider DNS panel (registrar or Cloudflare)
- SSH access to the VPS
- Ports 80 and 443 open in cloud firewall and server firewall

## 2. Find your VPS public IP

On your VPS, run one of these:

```bash
curl -4 ifconfig.me
```

or:

```bash
hostname -I
```

Use the public IPv4 address for DNS records.

## 3. Decide which hostname you want

Common patterns:

- Root domain: example.com
- Panel subdomain: panel.example.com
- API subdomain: api.example.com
- App subdomain: app.example.com

For StackDeployer panel, subdomain usage is recommended:
- panel.example.com

## 4. Add DNS records

Open your DNS provider panel and create A records.

### 4.1 Root domain to VPS

- Type: A
- Name/Host: @
- Value/Target: VPS_IP
- TTL: Auto or 300
- Proxy/CDN: DNS only for first setup (if Cloudflare)

### 4.2 Subdomain to VPS

- Type: A
- Name/Host: panel
- Value/Target: VPS_IP
- TTL: Auto or 300
- Proxy/CDN: DNS only for first setup (if Cloudflare)

You can add more subdomains the same way (api, app, etc.).

## 5. If using Cloudflare

For initial setup and SSL issuance, use:
- DNS record mode: DNS only (gray cloud)

After everything works (HTTP + SSL), you can switch to:
- Proxied (orange cloud)

Do not proxy before first SSL and routing validation, otherwise troubleshooting becomes harder.

## 6. Verify DNS propagation

From your local machine:

```bash
nslookup panel.example.com
```

or:

```bash
dig +short panel.example.com
```

Expected:
- Returned IP equals your VPS public IP

If IP is wrong or empty:
- Wait for propagation
- Re-check record values
- Make sure record type is A and host is correct

## 7. Verify VPS network and firewall

On VPS:

```bash
sudo ufw status
```

If needed:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

If your cloud provider has a security group/network ACL, open 80 and 443 there too.

## 8. Verify Nginx sees traffic

Basic check:

```bash
sudo nginx -t
sudo systemctl status nginx
```

HTTP check from your local machine:

```bash
curl -I http://panel.example.com
```

Expected:
- A valid HTTP response (200/301/302 depending on config)

## 9. Connect domain during StackDeployer install

Run installer with your panel hostname:

```bash
sudo PANEL_SERVER_NAME=panel.example.com CERTBOT_EMAIL=admin@example.com bash install.sh
```

This configures Nginx panel site and backend proxy paths.

## 10. Issue SSL certificate

After DNS and HTTP checks pass:

```bash
sudo certbot --nginx -d panel.example.com
```

If you also want root + www:

```bash
sudo certbot --nginx -d example.com -d www.example.com
```

## 11. Final validation

Check HTTPS:

```bash
curl -I https://panel.example.com
```

Open in browser:
- https://panel.example.com

Then verify login and API access from UI.

## 12. Troubleshooting matrix

### Domain resolves to wrong IP
- Wrong DNS record value
- Old record still cached
- Multiple conflicting A records

Action:
- Keep only correct A record
- Wait TTL duration
- Verify with dig or nslookup again

### Domain resolves but no HTTP response
- Nginx not running
- Port 80 blocked by firewall/security group

Action:
- Start Nginx
- Open 80
- Test curl to domain and VPS IP

### HTTP works but SSL fails
- DNS not fully propagated
- Port 80 blocked (HTTP challenge fails)
- Cloudflare proxy enabled too early

Action:
- Set Cloudflare to DNS only
- Open 80
- Retry certbot

### HTTPS works but app still unreachable
- Backend service down
- Nginx upstream/proxy mismatch

Action:
- Check stackdeployer service logs
- Validate Nginx config and reload

## 13. Recommended record set for StackDeployer

Minimum practical setup:

- panel.example.com -> VPS_IP (A)
- api.example.com -> VPS_IP (A) optional
- app.example.com -> VPS_IP (A) optional for deployed project routing

This keeps panel and hosted apps cleanly separated by subdomain.
