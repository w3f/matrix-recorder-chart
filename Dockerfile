FROM node:9

RUN set -ex \
    && apt-get clean \
    && apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends sqlite git apt-utils apt-transport-https ca-certificates


RUN git clone https://gitlab.com/argit/matrix-recorder.git

WORKDIR matrix-recorder

RUN yarn add https://packages.matrix.org/npm/olm/olm-3.1.4.tgz
RUN yarn add node-gyp

RUN mkdir -p w3f_matrix_log && mkdir -p w3f_matrix_log/localstorage
RUN bash -c 'touch w3f_matrix_log/localstorage/{accessToken,baseUrl,deviceId,userId}'
