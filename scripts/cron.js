var cron = require('node-cron');



cron.schedule('0 5 * * *', () => {
  console.log('running a task every day');
  const { spawn } = require("child_process");
  const update_html = spawn("./scripts/generatehtml.sh");

  update_html.stdout.on("data", data => {
      console.log(`stdout: ${data}`);
  });

  update_html.stderr.on("data", data => {
      console.log(`stderr: ${data}`);
  });

  update_html.on('error', (error) => {
      console.log(`error: ${error.message}`);
  });

  update_html.on("close", code => {
      console.log(`child process exited with code ${code}`);
  });

});
