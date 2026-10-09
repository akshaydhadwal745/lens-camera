# Lens video transcoder: makes HLS (fMP4) 540p + 1080p from an original in S3.
# Runs on AWS Batch (Fargate Spot). Static ffmpeg + AWS CLI on Amazon Linux.
FROM public.ecr.aws/amazonlinux/amazonlinux:2023

RUN dnf install -y awscli-2 tar xz && dnf clean all \
 && curl -fsSL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o /tmp/ff.tar.xz \
 && tar -xJf /tmp/ff.tar.xz -C /tmp \
 && mv /tmp/ffmpeg-*-static/ffmpeg /tmp/ffmpeg-*-static/ffprobe /usr/local/bin/ \
 && rm -rf /tmp/ff*

COPY transcode.sh /usr/local/bin/transcode.sh
RUN chmod +x /usr/local/bin/transcode.sh
ENTRYPOINT ["/usr/local/bin/transcode.sh"]
