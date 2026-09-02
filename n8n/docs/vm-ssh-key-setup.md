# VM SSH — match private key on Windows to public key on Oracle VM

SSH needs a **key pair**:

| Side | File |
|------|------|
| **Your PC (private)** | `C:\Users\piyus\.ssh\id_ed25519` — never upload this |
| **VM (public)** | `/home/ubuntu/.ssh/authorized_keys` — one line per key |

If you only pasted a public key on the VM but did not keep the matching **private** key on Windows, SSH will always return `Permission denied (publickey)`.

## Key generated for this machine (2026-09-02)

A new pair was created at:

- Private: `C:\Users\piyus\.ssh\id_ed25519`
- Public: `C:\Users\piyus\.ssh\id_ed25519.pub`

**Add this exact line to the VM** (Oracle console, browser agent, or any session that already has shell on the box):

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJVo/DhmCZkZMo+7UcNxcFz+zJLtzCN5jXGux2iNXTgw piyus@P' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Run as user **`ubuntu`** (not root), on host `161.118.180.71`.

### Oracle Cloud Console (no SSH yet)

1. [Oracle Cloud Console](https://cloud.oracle.com) → Compute → Instances → your VM.
2. **Console connection** or **Serial console** → open browser shell.
3. Log in as `ubuntu` (or `opc` then `sudo su - ubuntu`).
4. Run the three commands above.

Or: Instance → **Edit** → **Add SSH keys** — paste contents of `id_ed25519.pub` (adds to default user; on some images that is `opc`, not `ubuntu` — then use `ssh opc@161.118.180.71`).

## Test from Windows

```powershell
ssh ubuntu@161.118.180.71 "hostname"
```

Expected: hostname printed, no `Permission denied`.

## After SSH works — follow-up env (one paste)

```bash
sudo bash -c 'grep -q "^FOLLOWUP_ENABLED=" /etc/n8n/ms.env || cat >> /etc/n8n/ms.env <<EOF
FOLLOWUP_ENABLED=false
FOLLOWUP_BATCH_CAP=25
FOLLOWUP_MAX_TOUCHES=4
FOLLOWUP_HIGH_VALUE=100000
EOF'
cd /home/ubuntu && docker compose up -d n8n
docker compose exec n8n printenv | grep FOLLOWUP_
```

Then tell Cursor Agent to retry VM access.
