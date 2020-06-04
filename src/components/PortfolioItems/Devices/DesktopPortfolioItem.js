import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import {
  Card,
  Grid,
  CardHeader,
  CardMedia,
  CardActions,
  Button,
  IconButton,
  Typography,
} from "@material-ui/core";
import { Language, GitHub, Fullscreen } from "@material-ui/icons";
import BrowserButtons from "../../BrowserButtons/BrowserButtons";

const useStyles = makeStyles((theme) => ({
  avatar: {
    marginRight: 0,
    width: 50,
    padding: `0 ${theme.spacing(1)}px`,
  },
  action: {
    width: 50,
    margin: `${theme.spacing(0.5)}px 0`,
  },
  subheader: {
    color: theme.palette.getContrastText(theme.palette.grey[700]),
  },
  content: {
    margin: `${theme.spacing(0.5)}px ${theme.spacing(4)}px`,
    borderRadius: 25,
    background: theme.palette.grey[700],
  },
  cardHeader: {
    padding: 0,
    textAlign: "center",
    background: theme.palette.grey[800],
    color: theme.palette.getContrastText(theme.palette.grey[800]),
    boxShadow: theme.shadows[5],
  },
  cardMedia: {
    height: 225,
    margin: `0 auto`,
    backgroundPosition: "center top",
    backgroundSize: "cover",
  },
  cardButton: {
    marginLeft: theme.spacing(1),
  },
  rightButton: {
    marginLeft: "auto",
    padding: theme.spacing(1),
  },
}));
const DesktopPortfolioItem = ({ data }) => {
  const {
    cardHeader,
    cardMedia,
    avatar,
    action,
    content,
    subheader,
    cardButton,
    rightButton,
  } = useStyles();
  const { desktop_image, title, year_built, github, web_url } = data;

  const handleOpenProject = () => console.log("big");

  return (
    <Grid item xs={12} sm={6} md={4}>
      <Card>
        <CardHeader
          avatar={<BrowserButtons />}
          action={<Typography variant="body2">{year_built}</Typography>}
          classes={{
            avatar,
            action,
            content,
            subheader,
          }}
          className={cardHeader}
          subheader={title.toLowerCase()}
        />
        <CardMedia className={cardMedia} title={title} image={desktop_image} />
        <CardActions disableSpacing>
          {web_url && (
            <Button
              size="small"
              variant="contained"
              href={web_url}
              target="_blank"
              rel="noopener noreferrer"
              className={cardButton}
              startIcon={<Language />}
            >
              Web
            </Button>
          )}
          {github.map((link, index) => (
            <Button
              key={`${index}_link`}
              size="small"
              variant="contained"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cardButton}
              startIcon={<GitHub />}
            >
              {link.stack_type.replace(/_/g, " ")}
            </Button>
          ))}
          <IconButton className={rightButton} onClick={handleOpenProject}>
            <Fullscreen />
          </IconButton>
        </CardActions>
      </Card>
    </Grid>
  );
};

export default DesktopPortfolioItem;
