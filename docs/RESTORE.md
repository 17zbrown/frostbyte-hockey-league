# Database backup & restore runbook

The Supabase project (`bzbuyclwdhmhdzujxeqd`) is on the **free plan**, which has **no managed
backups and no point-in-time recovery**. The nightly `db-backup` GitHub Action
(`.github/workflows/db-backup.yml`) is our only safety net: it takes an encrypted `pg_dump` and
keeps it as a workflow artifact for 30 days.

## One-time setup (required before the workflow can run)

Add two repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | Where to get it |
| --- | --- |
| `DB_PASSWORD` | Supabase dashboard → Project Settings → Database → Connection string / password |
| `BACKUP_PASSPHRASE` | A long random string you generate and store in your password manager. **If you lose this, the backups are unrecoverable** — that is the point of encrypting them. |

Then run the workflow once by hand (Actions → *Nightly database backup* → **Run workflow**) to
confirm it produces a non-trivial artifact.

## Restoring

1. Download the encrypted artifact from the Actions run you want to restore
   (`cghl-YYYYMMDD-HHMMSS.sql.gz.enc`).
2. Decrypt and decompress it:
   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE \
     -in cghl-YYYYMMDD-HHMMSS.sql.gz.enc \
     | gunzip > restore.sql
   ```
   (Export `BACKUP_PASSPHRASE` in your shell first.)
3. Review `restore.sql` before applying it. **Restoring overwrites live data** — only do this on a
   fresh/empty project, or a specific table you have confirmed you want to replace. For a
   full-project restore, prefer a **new Supabase project** and repoint the site's Supabase URL/key,
   rather than clobbering production in place.
4. Apply it against the target with the session pooler host:
   ```bash
   PGPASSWORD='<db password>' psql \
     -h aws-0-us-east-1.pooler.supabase.com -p 5432 \
     -U postgres.<project-ref> -d postgres \
     -f restore.sql
   ```

## Notes

- The dump uses `--no-owner --no-privileges` so it restores cleanly under the Supabase `postgres`
  role without ownership conflicts.
- The workflow fails loudly if the dump comes out under ~10 KB (a sign the connection or auth
  failed), so a silent empty backup won't masquerade as success.
- The direct `db.<ref>.supabase.co` host is IPv6-only on the free tier; GitHub runners are IPv4, so
  both backup and restore use the **session pooler** host.
