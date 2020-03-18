#!/usr/bin/expect -f

set timeout 20

spawn node matrix-recorder.js /matrix-recorder/w3f_matrix_log

expect "Your homeserver (give full URL):"

send -- "https://matrix.web3.foundation\r"

expect "Your username at the homeserver:"

send -- "$env(W3F_MATRIXBOT_USERNAME)\r"

expect "Your password at the homeserver:"

send -- "$env(W3F_MATRIXBOT_PASSWORD)\r"

expect "No of items to retrieve for initial sync:"

send -- "0\n"

expect eof
