import { cloudImageMapper } from "../../../helpers/helpers";

const BlogFooter = () => {
    return (
        <div className="cf_blog_footer">
            <p>© {new Date().getFullYear()} CloudFuze, Inc. All rights reserved.</p>
            {/* <span style={{ marginLeft: "auto" }}></span> */}
        </div>
    )
}

export default BlogFooter;