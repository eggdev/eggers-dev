import React from "react";
import IconButton from "@material-ui/core/IconButton";
import Brightness2 from "@material-ui/icons/Brightness2";
import Brightness5 from "@material-ui/icons/Brightness5";

const DarkModeToggle = ({ isDarkMode, toggleDarkMode }) => {
  return (
    <IconButton onClick={toggleDarkMode}>
      {isDarkMode ? <Brightness5 /> : <Brightness2 />}
    </IconButton>
  );
};

export default DarkModeToggle;
