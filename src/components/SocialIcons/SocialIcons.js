import React from "react";
import Grid from "@material-ui/core/Grid";

import IconButton from "@material-ui/core/IconButton";
import GitHubIcon from "@material-ui/icons/GitHub";
import MailOutlineIcon from "@material-ui/icons/MailOutline";
import LinkedInIcon from "@material-ui/icons/LinkedIn";

const SocialIcons = () => {
  return (
    <>
      <IconButton href="https://github.com/beggers23">
        <GitHubIcon fontSize="large" />
      </IconButton>
      <IconButton href="mailto:eggers.brendan@gmail.com">
        <MailOutlineIcon fontSize="large" />
      </IconButton>
      <IconButton href="https://linkedin.com/in/brendaneggers">
        <LinkedInIcon fontSize="large" />
      </IconButton>
    </>
  );
};

export default SocialIcons;
