import { useEffect, useState } from "react";
import "../css/Blog.css";
import { cloudImageMapper } from "../../../helpers/helpers";

const BlogTopNav = () => {

    const [isScrolled, setIsScrolled] = useState(false);

    const handleScroll = () => {
        if (window.scrollY > 50) {
            setIsScrolled(true);
        } else {
            setIsScrolled(false);
        }
    };

    useEffect(() => {
        window.addEventListener('scroll', handleScroll);

        return () => {
            window.removeEventListener('scroll', handleScroll);
        };
    }, []);

    return (
        <nav className={`cf_blog_top_nav_glassmorphism ${isScrolled ? 'scrolled' : ''}`}>
            <img src={cloudImageMapper("CF")} alt="Blog" />
            <h2>Integrations Hub</h2>
        </nav>
    );
};

export default BlogTopNav;