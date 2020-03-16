FROM node:8.11

RUN set -ex \
    && apt-get clean \
    && apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends sqlite3 git apt-utils apt-transport-https ca-certificates


RUN git clone https://gitlab.com/argit/matrix-recorder.git

WORKDIR matrix-recorder

RUN yarn add olm
RUN yarn install --verbose --frozen-lockfile --optional
RUN mkdir -p w3f_matrix_log && mkdir -p w3f_matrix_log/localstorage
RUN touch /matrix-recorder/w3f_matrix_log/messages.sqlite
RUN chmod 755 /matrix-recorder/w3f_matrix_log/messages.sqlite

ENTRYPOINT ["node", "matrix-recorder.js", "w3f_matrix_log"]
