import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "code_groove.app:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8080")),
        proxy_headers=True,
        forwarded_allow_ips="*",
    )
