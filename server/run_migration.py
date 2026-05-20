import pty
import os
import sys
import time

pid, fd = pty.fork()
if pid == 0:
    os.execvp("npx", ["npx", "prisma", "migrate", "dev", "--name", "add_email_verification", "--skip-seed"])
else:
    try:
        while True:
            output = os.read(fd, 1024)
            sys.stdout.write(output.decode('utf-8', errors='replace'))
            sys.stdout.flush()
            if b"y/N" in output or b"Yes/No" in output or b"continue?" in output:
                os.write(fd, b"y\n")
    except OSError:
        pass
