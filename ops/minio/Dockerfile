FROM alpine:3.21

ARG TARGETARCH
ARG MINIO_RELEASE=RELEASE.2025-04-22T22-12-26Z
RUN apk add --no-cache ca-certificates curl \
    && case "$TARGETARCH" in \
      amd64) checksum=53e2a2cb16c5366ea6fbbc479c19ddb4c6a0948273e752f740fb1fbf27bb817c ;; \
      arm64) checksum=6c2f3142c94240206123177f4ba1e360daa5d1e0a4962e90757ef4f92c3ab57c ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl --fail --location --silent --show-error \
      "https://github.com/minio/minio/releases/download/${MINIO_RELEASE}/minio.linux-${TARGETARCH}.${MINIO_RELEASE}" \
      --output /usr/local/bin/minio \
    && echo "$checksum  /usr/local/bin/minio" | sha256sum -c - \
    && chmod +x /usr/local/bin/minio

ENTRYPOINT ["/usr/local/bin/minio"]
