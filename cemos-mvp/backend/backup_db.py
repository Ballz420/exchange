"""
FASEM-P Exchange — Database Auto-Backup
Run at startup + scheduled. Keeps last 7 daily backups.

Usage:
  python backup_db.py              # One-time backup
  python backup_db.py --schedule   # Run and keep running (checks every hour)
"""
import os, sys, shutil, glob, time
from datetime import datetime

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "cemos.db"))
BACKUP_DIR = os.environ.get("BACKUP_DIR", os.path.join(os.path.dirname(__file__), "backups"))
KEEP_DAYS = int(os.environ.get("BACKUP_KEEP_DAYS", "7"))

def backup():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    if not os.path.exists(DB_PATH):
        print(f"No database found at {DB_PATH}")
        return False
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_name = f"fasem_backup_{timestamp}.db"
    backup_path = os.path.join(BACKUP_DIR, backup_name)
    shutil.copy2(DB_PATH, backup_path)
    size_mb = os.path.getsize(backup_path) / (1024 * 1024)
    print(f"Backup created: {backup_name} ({size_mb:.1f} MB)")
    # Clean old backups
    backups = sorted(glob.glob(os.path.join(BACKUP_DIR, "fasem_backup_*.db")))
    while len(backups) > KEEP_DAYS:
        oldest = backups.pop(0)
        os.remove(oldest)
        print(f"Removed old backup: {os.path.basename(oldest)}")
    return True

if __name__ == "__main__":
    backup()
    if "--schedule" in sys.argv:
        print(f"Scheduling: backing up every 24 hours (keeping {KEEP_DAYS} backups)")
        while True:
            time.sleep(86400)  # 24 hours
            backup()
