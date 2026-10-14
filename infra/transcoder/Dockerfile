# Lens video transcoder: makes HLS (fMP4) from 540p up to the original's resolution (4K) from an original in S3.
# MODE=recap: renders a trip/event recap film from previews instead (recap.sh).
# Runs on AWS Batch (Fargate Spot). Static ffmpeg + AWS CLI on Amazon Linux.
FROM public.ecr.aws/amazonlinux/amazonlinux:2023

RUN dnf install -y awscli-2 tar xz jq fontconfig dejavu-sans-fonts && dnf clean all \
 && curl -fsSL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o /tmp/ff.tar.xz \
 && tar -xJf /tmp/ff.tar.xz -C /tmp \
 && mv /tmp/ffmpeg-*-static/ffmpeg /tmp/ffmpeg-*-static/ffprobe /usr/local/bin/ \
 && rm -rf /tmp/ff* \
 # Recap films need drawtext (titles), which the static build above lacks (no freetype):
 # BtbN's 8.1 release-branch build has it. Used by recap.sh only.
 && curl -fsSL https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz -o /tmp/fb.tar.xz \
 && mkdir -p /opt/ffmpeg-recap && tar -xJf /tmp/fb.tar.xz -C /opt/ffmpeg-recap --strip-components=2 --wildcards '*/bin/ffmpeg' '*/bin/ffprobe' \
 && rm -f /tmp/fb.tar.xz

COPY transcode.sh recap.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/transcode.sh /usr/local/bin/recap.sh
ENTRYPOINT ["/usr/local/bin/transcode.sh"]
