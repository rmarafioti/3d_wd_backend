The quarterly restore drill: proves the backups, the private key in 1Password and the restore steps still work. The record is SOC 2 evidence (`docs/security.md` → Restore drills).

## Steps

Follow `docs/deploy.md` → Restoring a backup:

1. Download the newest dump from the R2 dashboard (`3dwd-backups` → `backups/`).
2. Save the backup private key from 1Password (3DWD Production) to a file outside the repo.
3. Create a new, empty local database to restore into.
4. `npm run backup:restore -- --file <dump.enc> --key <private key .pem> --target <its URL>` (with `pg_restore` 17 on `PATH`, see `README.md`).
5. Check the rows against production: count `account`, `website`, `post`, `gallery` and `audit_event` in the restored database, and the same with SQL from the API's Render Shell. Counts can only differ by changes made since the dump.
6. Delete the throwaway database, the private key file and the downloaded dump.

## Record

On a branch, add a row to the Restore drills table in `docs/security.md`: the date, the dump's name and size, the row counts matched, and who ran it. Close this issue with a link to that PR.

If the restore fails, that is an incident (`docs/security.md` → Incident response): the backups can't be trusted until it is fixed.
