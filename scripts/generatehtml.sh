tar -zcvf /matrix-recorder/w3f_matrix_log/html-$(date +'%m-%d-%Y').tar.gz /matrix-recorder/w3f_matrix_log/html --remove-files
node recorder-to-html.js w3f_matrix_log/
find /matrix-recorder/w3f_matrix_log/html-*.tar.gz -mtime +30 -exec rm -rf {} \;
