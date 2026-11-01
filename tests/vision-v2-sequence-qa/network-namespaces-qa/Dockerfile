FROM python:3.12-slim
RUN python -m pip install --no-cache-dir 'psycopg[binary]==3.2.6'
COPY tests/vision-v2-sequence-qa/network-namespaces-qa/replica.py /app/replica.py
WORKDIR /app
USER 65534:65534
ENTRYPOINT ["python","-u","/app/replica.py"]
